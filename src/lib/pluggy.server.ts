const PLUGGY_API_URL = "https://api.pluggy.ai";

type PluggyList<T> = {
  results?: T[];
  next?: string | null;
};

export type PluggyAccount = {
  id: string;
  itemId: string;
  name: string;
  type?: string;
  subtype?: string;
  number?: string;
};

export type PluggyTransaction = {
  id: string;
  accountId: string;
  description?: string | null;
  amount: number;
  date: string;
  status?: string;
  direction?: "CREDIT" | "DEBIT";
};

function credentials() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("A integração Pluggy ainda não está configurada.");
  }
  return { clientId, clientSecret };
}

async function pluggyRequest<T>(path: string, init: RequestInit = {}, apiKey?: string) {
  const response = await fetch(`${PLUGGY_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-KEY": apiKey } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`[Pluggy] ${response.status} ${path}: ${detail}`);
    throw new Error("O Pluggy não respondeu como esperado. Tente novamente em instantes.");
  }
  return (await response.json()) as T;
}

export async function createPluggyApiKey() {
  const auth = await pluggyRequest<{ apiKey: string }>("/auth", {
    method: "POST",
    body: JSON.stringify(credentials()),
  });
  return auth.apiKey;
}

export async function createPluggyConnectToken(clientUserId: string) {
  const apiKey = await createPluggyApiKey();
  const token = await pluggyRequest<{ accessToken: string }>(
    "/connect_token",
    {
      method: "POST",
      body: JSON.stringify({ options: { clientUserId, avoidDuplicates: true } }),
    },
    apiKey,
  );
  return token.accessToken;
}

export async function listPluggyAccounts(itemId: string) {
  const apiKey = await createPluggyApiKey();
  const query = new URLSearchParams({ itemId });
  const result = await pluggyRequest<PluggyList<PluggyAccount>>(
    `/accounts?${query.toString()}`,
    {},
    apiKey,
  );
  return result.results ?? [];
}

export async function listPluggyTransactions(accountId: string, from: string, to: string) {
  const apiKey = await createPluggyApiKey();
  const transactions: PluggyTransaction[] = [];
  let path = `/v2/transactions?${new URLSearchParams({ accountId, from, to }).toString()}`;

  for (let page = 0; path && page < 20; page += 1) {
    const result = await pluggyRequest<PluggyList<PluggyTransaction>>(path, {}, apiKey);
    transactions.push(...(result.results ?? []));
    path = result.next ? `/v2/transactions${result.next}` : "";
  }
  return transactions;
}
