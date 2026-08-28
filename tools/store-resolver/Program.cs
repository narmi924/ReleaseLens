using System.Globalization;
using System.Net;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

internal static class Program
{
    private const string CatalogBase = "https://displaycatalog.mp.microsoft.com/v7.0/products";
    private const string Fe3Endpoint = "https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx";
    private const string Fe3SecuredEndpoint = "https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx/secured";
    private const string ServiceNamespace = "http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService";
    private static readonly int[] BaselineDetectoids =
    {
        1, 2, 3, 11, 19, 544, 549, 2359974, 5169044, 8788830, 23110993, 23110994, 54341900, 54343656,
        59830006, 59830007, 59830008, 60484010, 62450018, 62450019, 62450020, 66027979, 66053150,
        97657898, 98822896, 98959022, 98959023, 98959024, 98959025, 98959026, 104433538, 104900364,
        105489019, 117765322, 129905029, 130040031, 132387090, 132393049, 133399034, 138537048,
        140377312, 143747671, 158941041, 158941042, 158941043, 158941044, 159123858, 159130928,
        164836897, 164847386, 164848327, 164852241, 164852246, 164852252, 164852253,
    };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            var options = ResolverOptions.Parse(args);
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("ReleaseLens/1.0 StoreResolver");
            client.DefaultRequestHeaders.TryAddWithoutValidation("MS-CV", $"{Guid.NewGuid():N}"[..16] + ".0");

            var wuCategoryId = await GetWuCategoryIdAsync(client, options);
            var deviceAttributes = DeviceAttributes.For(options.Architecture);
            var cookie = await GetCookieAsync(client);
            var candidates = ParseSyncUpdates(await SyncUpdatesAsync(client, cookie, wuCategoryId, deviceAttributes));
            var selected = SelectCandidate(candidates, options.PackageIdentity, options.Architecture)
                ?? throw new InvalidOperationException("FE3 returned no package that matches the requested identity and architecture.");
            var temporaryUri = await GetDownloadUriAsync(client, selected, deviceAttributes);
            var packageVersion = ParsePackageVersion(selected.PackageMoniker)?.ToString()
                ?? throw new InvalidOperationException("FE3 returned a package moniker with an invalid four-part version.");

            var output = new ResolutionOutput(
                1,
                options.ProductId,
                options.PackageIdentity,
                options.Architecture,
                selected.PackageMoniker,
                packageVersion,
                selected.UpdateId,
                selected.RevisionNumber,
                temporaryUri.Host,
                temporaryUri.AbsoluteUri);
            Console.Out.WriteLine(JsonSerializer.Serialize(output, JsonOptions));
            return 0;
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 2;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Store resolver failed: {exception.Message}");
            return 1;
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<string> GetWuCategoryIdAsync(HttpClient client, ResolverOptions options)
    {
        var url = $"{CatalogBase}/{Uri.EscapeDataString(options.ProductId)}?market={Uri.EscapeDataString(options.Market)}&languages=en-US,en,neutral";
        using var response = await client.GetAsync(url);
        var content = await response.Content.ReadAsStringAsync();
        EnsureSuccess(response, content);
        using var document = JsonDocument.Parse(content);
        return FindString(document.RootElement, "WuCategoryId")
            ?? throw new InvalidOperationException("DisplayCatalog did not expose WuCategoryId.");
    }

    private static async Task<string> GetCookieAsync(HttpClient client)
    {
        var body = $"""
            <GetCookie xmlns="{ServiceNamespace}">
              <oldCookie />
              <lastChange>2015-10-21T17:01:07.147Z</lastChange>
              <currentTime>{SoapTime(DateTimeOffset.UtcNow)}</currentTime>
              <protocolVersion>1.40</protocolVersion>
            </GetCookie>
            """;
        var response = XDocument.Parse(await SendSoapAsync(client, Fe3Endpoint, "GetCookie", body));
        return response.Descendants().FirstOrDefault(node => node.Name.LocalName == "EncryptedData")?.Value.Trim()
            ?? throw new InvalidOperationException("FE3 GetCookie did not return an encrypted cookie.");
    }

    private static async Task<string> SyncUpdatesAsync(HttpClient client, string cookie, string wuCategoryId, string deviceAttributes)
    {
        var installedIds = string.Concat(BaselineDetectoids.Select(id => $"<int>{id}</int>"));
        var body = $"""
            <SyncUpdates xmlns="{ServiceNamespace}">
              <cookie>
                <Expiration>{SoapTime(DateTimeOffset.UtcNow.AddDays(1))}</Expiration>
                <EncryptedData>{Xml(cookie)}</EncryptedData>
              </cookie>
              <parameters>
                <ExpressQuery>false</ExpressQuery>
                <InstalledNonLeafUpdateIDs>{installedIds}</InstalledNonLeafUpdateIDs>
                <OtherCachedUpdateIDs />
                <SkipSoftwareSync>false</SkipSoftwareSync>
                <NeedTwoGroupOutOfScopeUpdates>true</NeedTwoGroupOutOfScopeUpdates>
                <FilterAppCategoryIds><CategoryIdentifier><Id>{Xml(wuCategoryId)}</Id></CategoryIdentifier></FilterAppCategoryIds>
                <TreatAppCategoryIdsAsInstalled>true</TreatAppCategoryIdsAsInstalled>
                <AlsoPerformRegularSync>false</AlsoPerformRegularSync>
                <ComputerSpec />
                <ExtendedUpdateInfoParameters>
                  <XmlUpdateFragmentTypes><XmlUpdateFragmentType>Extended</XmlUpdateFragmentType></XmlUpdateFragmentTypes>
                  <Locales><string>en-US</string><string>en</string></Locales>
                </ExtendedUpdateInfoParameters>
                <ClientPreferredLanguages><string>en-US</string></ClientPreferredLanguages>
                <ProductsParameters>
                  <SyncCurrentVersionOnly>false</SyncCurrentVersionOnly>
                  <DeviceAttributes>{Xml(deviceAttributes)}</DeviceAttributes>
                  <CallerAttributes>Interactive=1;IsSeeker=0;</CallerAttributes>
                  <Products />
                </ProductsParameters>
              </parameters>
            </SyncUpdates>
            """;
        return await SendSoapAsync(client, Fe3Endpoint, "SyncUpdates", body);
    }

    private static IReadOnlyList<Fe3Package> ParseSyncUpdates(string soap)
    {
        var document = XDocument.Parse(soap);
        var results = new List<Fe3Package>();
        foreach (var xml in document.Descendants().Where(node => node.Name.LocalName == "Xml"))
        {
            var fragment = TryReadFragment(xml.Value) ?? TryReadFragment(WebUtility.HtmlDecode(xml.Value));
            if (fragment is null
                || !fragment.Descendants().Any(node => node.Name.LocalName == "AppxMetadata")
                || !fragment.Descendants().Any(node => node.Name.LocalName == "SecuredFragment"))
            {
                continue;
            }
            var identity = fragment.Descendants().FirstOrDefault(node => node.Name.LocalName == "UpdateIdentity");
            var metadata = fragment.Descendants().FirstOrDefault(node => node.Name.LocalName == "AppxMetadata");
            var updateId = Field(identity, "UpdateID");
            var revision = Field(identity, "RevisionNumber");
            var moniker = Field(metadata, "PackageMoniker");
            var packageType = Field(metadata, "PackageType");
            if (string.IsNullOrWhiteSpace(updateId) || string.IsNullOrWhiteSpace(revision)
                || string.IsNullOrWhiteSpace(moniker) || string.IsNullOrWhiteSpace(packageType))
            {
                continue;
            }
            results.Add(new Fe3Package(moniker, packageType, updateId, revision));
        }
        return results;
    }

    private static async Task<Uri> GetDownloadUriAsync(HttpClient client, Fe3Package package, string deviceAttributes)
    {
        var body = $"""
            <GetExtendedUpdateInfo2 xmlns="{ServiceNamespace}">
              <updateIDs><UpdateIdentity><UpdateID>{Xml(package.UpdateId)}</UpdateID><RevisionNumber>{Xml(package.RevisionNumber)}</RevisionNumber></UpdateIdentity></updateIDs>
              <infoTypes><XmlUpdateFragmentType>FileUrl</XmlUpdateFragmentType><XmlUpdateFragmentType>FileDecryption</XmlUpdateFragmentType></infoTypes>
              <deviceAttributes>{Xml(deviceAttributes)}</deviceAttributes>
            </GetExtendedUpdateInfo2>
            """;
        var response = XDocument.Parse(await SendSoapAsync(client, Fe3SecuredEndpoint, "GetExtendedUpdateInfo2", body));
        var candidates = response.Descendants()
            .Where(node => node.Name.LocalName == "Url")
            .Select(node => Uri.TryCreate(node.Value.Trim(), UriKind.Absolute, out var uri) ? uri : null)
            .Where(uri => uri is not null && IsMicrosoftDeliveryUri(uri))
            .Cast<Uri>()
            .OrderByDescending(uri => uri.AbsoluteUri.Length)
            .ToArray();
        return candidates.FirstOrDefault()
            ?? throw new InvalidOperationException("FE3 did not return an allowed Microsoft delivery URL.");
    }

    private static async Task<string> SendSoapAsync(HttpClient client, string endpoint, string operation, string body)
    {
        var action = $"{ServiceNamespace}/{operation}";
        var created = DateTimeOffset.UtcNow;
        var envelope = $"""
            <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
              <s:Header>
                <a:Action s:mustUnderstand="1">{Xml(action)}</a:Action>
                <a:MessageID>urn:uuid:{Guid.NewGuid()}</a:MessageID>
                <a:To s:mustUnderstand="1">{Xml(endpoint)}</a:To>
                <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
                  <Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
                    <Created>{SoapTime(created)}</Created><Expires>{SoapTime(created.AddMinutes(5))}</Expires>
                  </Timestamp>
                  <wuws:WindowsUpdateTicketsToken wsu:id="ClientMSA" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:wuws="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization">
                    <TicketType Name="MSA" Version="1.0" Policy="MBI_SSL"><User /></TicketType>
                  </wuws:WindowsUpdateTicketsToken>
                </o:Security>
              </s:Header>
              <s:Body>{body}</s:Body>
            </s:Envelope>
            """;
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(envelope, Encoding.UTF8, "application/soap+xml"),
        };
        using var response = await client.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();
        EnsureSuccess(response, content);
        return content;
    }

    private static Fe3Package? SelectCandidate(IEnumerable<Fe3Package> candidates, string identity, string architecture)
    {
        return candidates
            .Where(candidate => MatchesIdentity(candidate.PackageMoniker, identity, architecture))
            .OrderByDescending(candidate => ParsePackageVersion(candidate.PackageMoniker))
            .FirstOrDefault();
    }

    private static bool MatchesIdentity(string moniker, string identity, string architecture)
    {
        var parts = moniker.Split('_');
        return parts.Length >= 5
            && parts[0].Equals(identity, StringComparison.OrdinalIgnoreCase)
            && parts[^3].Equals(architecture, StringComparison.OrdinalIgnoreCase);
    }

    private static Version? ParsePackageVersion(string moniker)
    {
        var parts = moniker.Split('_');
        return parts.Length >= 5 && Version.TryParse(parts[^4], out var version) ? version : null;
    }

    private static bool IsMicrosoftDeliveryUri(Uri uri)
    {
        return (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            && (uri.Host.Equals("dl.delivery.mp.microsoft.com", StringComparison.OrdinalIgnoreCase)
                || uri.Host.EndsWith(".dl.delivery.mp.microsoft.com", StringComparison.OrdinalIgnoreCase));
    }

    private static XDocument? TryReadFragment(string value)
    {
        try
        {
            return XDocument.Parse($"<Root>{value}</Root>");
        }
        catch
        {
            return null;
        }
    }

    private static string? Field(XElement? element, string field)
    {
        return element?.Attribute(field)?.Value
            ?? element?.Elements().FirstOrDefault(child => child.Name.LocalName == field)?.Value;
    }

    private static string? FindString(JsonElement element, string key)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.NameEquals(key) && property.Value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(property.Value.GetString()))
                {
                    return property.Value.GetString();
                }
                var nested = FindString(property.Value, key);
                if (nested is not null)
                {
                    return nested;
                }
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
            {
                var nested = FindString(child, key);
                if (nested is not null)
                {
                    return nested;
                }
            }
        }
        return null;
    }

    private static void EnsureSuccess(HttpResponseMessage response, string content)
    {
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"HTTP {(int)response.StatusCode}: {content.ReplaceLineEndings(" ")[..Math.Min(content.Length, 500)]}");
        }
    }

    private static string Xml(string value) => SecurityElement.Escape(value) ?? string.Empty;
    private static string SoapTime(DateTimeOffset time) => time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private sealed record Fe3Package(string PackageMoniker, string PackageType, string UpdateId, string RevisionNumber);
    private sealed record ResolutionOutput(
        int SchemaVersion,
        string ProductId,
        string PackageIdentity,
        string Architecture,
        string PackageMoniker,
        string PackageVersion,
        string UpdateId,
        string RevisionNumber,
        string SourceHost,
        string TemporaryUrl);

    private sealed record ResolverOptions(string ProductId, string PackageIdentity, string Architecture, string Market)
    {
        public static ResolverOptions Parse(string[] args)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < args.Length; index += 2)
            {
                if (!args[index].StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
                {
                    throw new ArgumentException("Usage: --product-id <id> --package-identity <identity> --architecture <x64|arm64> [--market <market>]");
                }
                values[args[index][2..]] = args[index + 1];
            }
            var productId = Required(values, "product-id");
            var identity = Required(values, "package-identity");
            var architecture = Required(values, "architecture").ToLowerInvariant() switch
            {
                "amd64" => "x64",
                "x64" => "x64",
                "arm64" => "arm64",
                var value => throw new ArgumentException($"Unsupported Store architecture: {value}.")
            };
            if (identity.Contains('_', StringComparison.Ordinal))
            {
                throw new ArgumentException("Package identity must not be a package full name.");
            }
            return new ResolverOptions(productId, identity, architecture, values.GetValueOrDefault("market", "US"));
        }

        private static string Required(IReadOnlyDictionary<string, string> values, string key)
        {
            return values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
                ? value.Trim()
                : throw new ArgumentException($"Missing required argument --{key}.");
        }
    }

    private static class DeviceAttributes
    {
        public static string For(string architecture)
        {
            var osArchitecture = architecture == "arm64" ? "ARM64" : "AMD64";
            return $"OSArchitecture={osArchitecture};DeviceFamily=Windows.Desktop;App=WU;AppVer=10.0.22621.1;OSVersion=10.0.22621.1;InstallationType=Client;IsDeviceRetailDemo=0;";
        }
    }
}
