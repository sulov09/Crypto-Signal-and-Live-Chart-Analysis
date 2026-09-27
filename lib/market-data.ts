type CoinGeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap_rank: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_percentage_24h: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
  sparkline_in_7d?: { price: number[] };
};

type CoinCapAsset = {
  id: string;
  rank: string;
  symbol: string;
  name: string;
  supply: string;
  marketCapUsd: string;
  volumeUsd24Hr: string;
  priceUsd: string;
  changePercent24Hr: string;
};

export type MarketCoin = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap_rank: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_percentage_24h: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
  sparkline_in_7d?: {
    price: number[];
  };
};

async function fetchCoinGecko(limit: number): Promise<MarketCoin[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`CoinGecko failed (${res.status})`);
  }

  const rows = (await res.json()) as CoinGeckoMarket[];
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    current_price: r.current_price,
    market_cap_rank: r.market_cap_rank,
    market_cap: r.market_cap,
    total_volume: r.total_volume,
    high_24h: r.high_24h,
    low_24h: r.low_24h,
    price_change_percentage_24h: r.price_change_percentage_24h,
    price_change_percentage_1h_in_currency: r.price_change_percentage_1h_in_currency,
    price_change_percentage_7d_in_currency: r.price_change_percentage_7d_in_currency,
    sparkline_in_7d: r.sparkline_in_7d,
  }));
}

async function fetchCoinCap(limit: number): Promise<MarketCoin[]> {
  const res = await fetch(`https://api.coincap.io/v2/assets?limit=${Math.min(limit, 200)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CoinCap failed (${res.status})`);
  }

  const payload = (await res.json()) as { data: CoinCapAsset[] };

  return payload.data.map((asset) => {
    const price = Number(asset.priceUsd || 0);
    const change24h = Number(asset.changePercent24Hr || 0);
    const high = price * (1 + Math.max(change24h, 0) / 100);
    const low = price * (1 - Math.max(-change24h, 0) / 100);
    const sparkline = Array.from({ length: 168 }).map((_, i) => {
      const factor = i / 167;
      const drift = change24h / 100;
      return price * (1 - drift + drift * factor);
    });

    return {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      current_price: price,
      market_cap_rank: Number(asset.rank || 999),
      market_cap: Number(asset.marketCapUsd || 0),
      total_volume: Number(asset.volumeUsd24Hr || 0),
      high_24h: high,
      low_24h: Math.max(low, 0.0000001),
      price_change_percentage_24h: change24h,
      price_change_percentage_1h_in_currency: change24h / 24,
      price_change_percentage_7d_in_currency: change24h * 1.4,
      sparkline_in_7d: { price: sparkline },
    };
  });
}

export async function fetchMarketCoins(limit = 200): Promise<{ coins: MarketCoin[]; provider: string }> {
  const preferred = process.env.MARKET_DATA_PROVIDER ?? "coingecko";

  // Future-ready: add premium providers here (e.g., Kaiko/CryptoCompare paid tiers)
  // by branching on MARKET_DATA_PROVIDER and using provider-specific credentials.
  if (preferred === "coincap") {
    try {
      return { coins: await fetchCoinCap(limit), provider: "coincap" };
    } catch {
      return { coins: await fetchCoinGecko(limit), provider: "coingecko-fallback" };
    }
  }

  try {
    return { coins: await fetchCoinGecko(limit), provider: "coingecko" };
  } catch {
    return { coins: await fetchCoinCap(limit), provider: "coincap-fallback" };
  }
}
