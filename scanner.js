const axios = require('axios');
const fs = require('fs');

// Memformat nominal Rupiah ke format rapi (Juta / Miliar)
function formatRupiah(amount) {
  if (amount >= 1000000000) {
    return `Rp ${(amount / 1000000000).toFixed(2)} Miliar`;
  }
  return `Rp ${(amount / 1000000).toFixed(1)} Juta`;
}

async function scanPair(pair, tickerData) {
  const coinName = pair.replace('_idr', '').toUpperCase();
  const lastPrice = parseFloat(tickerData.last);
  const lowPrice = parseFloat(tickerData.low);
  const total24hVol = parseFloat(tickerData.vol_idr);

  // 1. FILTER HARGA MURAH (Pre-Pump Zone <= 3.0% dari Low)
  let priceChangeFromLow = 0;
  if (lowPrice > 0) {
    priceChangeFromLow = ((lastPrice - lowPrice) / lowPrice) * 100;
  }

  // Abaikan jika harga sudah terlanjur naik tinggi (> 3.0% dari terendah harian)
  if (priceChangeFromLow > 3.0) return null;

  try {
    const response = await axios.get(`https://indodax.com/api/trades/${pair}`, { timeout: 8000 });
    const trades = response.data;

    if (!Array.isArray(trades) || trades.length === 0) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const TIME_WINDOW_SECONDS = 15 * 60; // Batas analisis: 15 Menit Terakhir

    let totalRecentBuyVal = 0;
    let maxSingleBuyVal = 0;
    let buyCount = 0;
    let latestBuyTimestamp = null;

    // 2. ANALISIS DEEP TRADE HISTORY (Presisi Waktu & Jenis Order)
    for (let trade of trades) {
      const tradeTime = parseInt(trade.date);
      
      // Hanya proses transaksi yang terjadi dalam 15 menit terakhir
      if (nowSeconds - tradeTime > TIME_WINDOW_SECONDS) continue;

      if (trade.type === 'buy') {
        const price = parseFloat(trade.price);
        const amount = parseFloat(trade.amount);
        const valIDR = price * amount;

        totalRecentBuyVal += valIDR;
        buyCount++;

        if (valIDR > maxSingleBuyVal) {
          maxSingleBuyVal = valIDR;
          latestBuyTimestamp = tradeTime * 1000;
        }
      }
    }

    // 3. AMBANG BATAS PAUS (ACCURACY THRESHOLD)
    const THRESHOLD_SINGLE_BUY = 5000000;    // Instant Buy >= Rp 5 Juta
    const THRESHOLD_ACCUMULATION = 10000000; // Serok Akumulasi >= Rp 10 Juta

    const isInstantWhale = maxSingleBuyVal >= THRESHOLD_SINGLE_BUY;
    const isAccumulationWhale = totalRecentBuyVal >= THRESHOLD_ACCUMULATION && buyCount >= 2;

    if (isInstantWhale || isAccumulationWhale) {
      const timeString = latestBuyTimestamp
        ? new Date(latestBuyTimestamp).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        : new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });

      let triggerVal = isInstantWhale ? maxSingleBuyVal : totalRecentBuyVal;
      let message = isInstantWhale
        ? `Order BUY Instan Paus sebesar ${formatRupiah(maxSingleBuyVal)}!`
        : `Akumulasi Serok Paus total ${formatRupiah(totalRecentBuyVal)} (${buyCount} order)!`;

      return {
        id: pair,
        coin: `${coinName}/IDR`,
        price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
        change: `+${priceChangeFromLow.toFixed(2)}% dari Low`,
        volume: formatRupiah(total24hVol),
        rawTriggerVal: triggerVal,
        status: 'WHALE_BUY',
        message: `${message} (Posisi harga murah: +${priceChangeFromLow.toFixed(1)}% dari Low)`,
        timestamp: timeString
      };
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function startScan() {
  console.log('Memulai Pemindaian Paus Presisi Tinggi (Indodax)...');

  try {
    const summaryRes = await axios.get('https://indodax.com/api/summaries', { timeout: 10000 });
    const tickers = summaryRes.data.tickers;

    // Filter koin valid (Kecualikan stablecoin & koin mati dengan volume < Rp 30 Juta)
    const ignored = ['USDT', 'USDC'];
    const validPairs = Object.keys(tickers).filter(pair => {
      const coinName = pair.replace('_idr', '').toUpperCase();
      const vol24h = parseFloat(tickers[pair].vol_idr);
      return pair.endsWith('_idr') && !ignored.includes(coinName) && vol24h >= 30000000;
    });

    const scanPromises = validPairs.map(pair => scanPair(pair, tickers[pair]));
    const results = await Promise.all(scanPromises);

    const detectedSignals = results
      .filter(item => item !== null)
      .sort((a, b) => b.rawTriggerVal - a.rawTriggerVal)
      .map(({ rawTriggerVal, ...rest }) => rest);

    fs.writeFileSync('signals.json', JSON.stringify(detectedSignals, null, 2));
    console.log(`Pemindaian Selesai. Sinyal Paus Akurat Terkonfirmasi: ${detectedSignals.length}`);
  } catch (error) {
    console.error('Gagal memindai:', error.message);
  }
}

startScan();
