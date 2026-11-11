import { parse } from "tldts";
import type { AuthenticatorAccount } from "./view";
export interface PageContext {
  hostname: string;
  title?: string;
  faviconReady?: boolean;
}
const clean = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
// Identities describe account providers, not every sibling product they own.
const providerAliases: Array<[names: string[], domains: string[]]> = [
  [
    ["Apple", "Apple ID", "iCloud"],
    ["apple.com", "icloud.com"],
  ],
  [
    ["Mozilla", "Mozilla Account", "Firefox"],
    ["firefox.com", "mozilla.org"],
  ],
  [["Ubisoft", "Uplay"], ["ubisoft.com"]],
  [
    ["Tuta", "Tutanota"],
    ["tutanota.com", "tuta.com"],
  ],
  [["GoTo", "LogMeIn"], ["goto.com"]],
  [["Google"], ["google.com", "gmail.com", "fitbit.com"]],
  [["Microsoft"], ["microsoft.com", "office.com"]],
  [["Microsoft", "Live", "Outlook"], ["live.com"]],
  [["Azure", "Microsoft"], ["azure.com"]],
  [["Visual Studio", "Microsoft"], ["visualstudio.com"]],
  [["Instagram"], ["instagram.com", "threads.com"]],
  [
    ["Atlassian", "Trello"],
    ["trello.com", "atlassian.com"],
  ],
  [
    ["Adobe", "Adobe ID"],
    ["adobe.com", "behance.net"],
  ],
  [["Amazon"], ["amazon.com", "audible.com"]],
  [["AWS", "Amazon Web Services"], ["aws.amazon.com"]],
  [
    ["Intuit", "QuickBooks"],
    ["quickbooks.com", "intuit.com"],
  ],
  [
    ["Anthropic", "Claude"],
    ["claude.ai", "anthropic.com"],
  ],
  [["Steam"], ["steampowered.com", "steamcommunity.com"]],
  [
    ["Riot Games", "Valorant"],
    ["valorant.com", "riotgames.com"],
  ],
  [["npm"], ["npmjs.com"]],
  [["Cisco Duo", "Duo"], ["duosecurity.com"]],
  [["Keeper"], ["keepersecurity.com"]],
  [
    ["Xiaomi", "Mi"],
    ["mi.com", "xiaomi.com"],
  ],
  [
    ["Wikimedia", "Wikipedia"],
    ["wikipedia.org", "wikimedia.org"],
  ],
  [
    ["X", "Twitter"],
    ["x.com", "twitter.com"],
  ],
  [
    ["OpenAI", "ChatGPT"],
    ["openai.com", "chatgpt.com"],
  ],
  [["ID.me"], ["id.me"]],
  [["Login.gov"], ["login.gov"]],
];
export const SITE_IDENTITY_OVERRIDES = providerAliases.map(
  ([names, domains]) => ({ names, domains }),
);
const namesByDomain = new Map(
  providerAliases.flatMap(([names, domains]) =>
    domains.map((host) => [host, names] as const),
  ),
);

function aliasesForHost(hostname: string): string[] | undefined {
  let suffix = hostname;
  while (suffix) {
    const aliases = namesByDomain.get(suffix);
    if (aliases) return aliases;
    const separator = suffix.indexOf(".");
    if (separator < 0) return;
    suffix = suffix.substring(separator + 1);
  }
}

export function getAccountPageMatchScore(
  account: AuthenticatorAccount,
  context: PageContext | null,
): number {
  if (!context?.hostname || /[:/\s]/.test(context.hostname)) return 0;
  const host = context.hostname.toLowerCase().replace(/\.$/, "");
  if (account.site)
    return host === account.site || host.endsWith("." + account.site)
      ? 1000
      : 0;
  const parts = parse(host, { allowPrivateDomains: true });
  if (parts.isPrivate) return 0;
  const domain = parts.domain ?? host;
  const names = aliasesForHost(host) ?? [
    domain,
    parts.domainWithoutSuffix ?? host,
  ];
  function score(value: string) {
    if (names.some((name) => clean(name) === clean(value))) return 100;
    return names.some(
      (name) =>
        clean(name).length > 3 &&
        !name.includes(".") &&
        ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(
          ` ${name.toLowerCase()} `,
        ),
    )
      ? 70
      : 0;
  }
  let value = score(account.issuer) * 3;
  if (!value && !account.label.includes("@"))
    value = score(account.label) * (account.issuer ? 1 : 2);
  if (
    !account.issuer &&
    !value &&
    account.label.split("@")[1]?.toLowerCase() === domain
  )
    value = 150;
  return (
    value +
    (value &&
    account.issuer &&
    context.title &&
    clean(context.title).includes(clean(account.issuer))
      ? 1
      : 0)
  );
}
export function rankAccountsForPage(
  accounts: readonly AuthenticatorAccount[],
  context: PageContext | null,
) {
  return accounts
    .map((account, index) => ({
      account,
      index,
      score: getAccountPageMatchScore(account, context),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.account);
}
export function getAccountPageRanking(
  accounts: readonly AuthenticatorAccount[],
  context: PageContext | null,
) {
  return {
    accounts: rankAccountsForPage(accounts, context),
    suggestedAccountIds: new Set(
      accounts
        .filter((account) => getAccountPageMatchScore(account, context) > 0)
        .map((account) => account.id),
    ),
  };
}
export function getAccountListView(
  accounts: readonly AuthenticatorAccount[],
  suggested: Set<string>,
  options: { query: string; alwaysShowAll: boolean; revealAll: boolean },
) {
  const query = options.query.trim().toLowerCase();
  const matching = accounts.filter(
    (item) =>
      !query || `${item.issuer} ${item.label}`.toLowerCase().includes(query),
  );
  const folded =
    query || options.alwaysShowAll || !suggested.size
      ? []
      : matching.filter((item) => !suggested.has(item.id));
  const grouped = folded.length > 0 && folded.length < matching.length;
  return {
    accounts: grouped
      ? matching.filter((item) => suggested.has(item.id))
      : matching,
    revealedAccounts: grouped && options.revealAll ? folded : [],
    hiddenCount: grouped ? folded.length : 0,
    contextualAction: grouped
      ? options.revealAll
        ? "showMatches"
        : "showAll"
      : null,
  };
}
