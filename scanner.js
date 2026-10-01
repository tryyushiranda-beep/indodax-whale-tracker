const axios = require('axios');
const fs = require('fs');

// Format nominal Rupiah ke tampilan rapi (Juta / Miliar)
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

  // 1. FILTER HARGA MURAH (Pre-Pump Zone)
  let priceChangeFromLow = 0;
  if (lowPrice > 0) {
    priceChangeFromLow = ((lastPrice - lowPrice) / lowPrice) * 100;
  }

  // Abaikan koin yang sudah naik lebih dari +2.5% dari harga terendah harian
  if (priceChangeFromLow > 2.5) return null;

  try {
    // Mengambil hingga 1000 transaksi terbaru untuk analisis mendalam & luas
    const response = await axios.get(`https://indodax.com/api/trades/${pair}`, { timeout: 10000 });
    const trades = response.data;

    if (!Array.isArray(trades) || trades.length === 0) return null;

    let totalRecentBuyVal = 0;
    let maxSingleBuyVal = 0;
    let buyCount = 0;
    let latestBuyTimestamp = null;

    // Evaluasi seluruh riwayat transaksi BUY yang dikembalikan API (hingga 1000 transaksi)
    for (let trade of trades) {
      if (trade.type === 'buy') {
        const price = parseFloat(trade.price);
        const amount = parseFloat(trade.amount);
        const valIDR = price * amount;

        totalRecentBuyVal += valIDR;
        buyCount++;

        if (valIDR > maxSingleBuyVal) {
          maxSingleBuyVal = valIDR;
          latestBuyTimestamp = parseInt(trade.date) * 1000;
        }
      }
    }

    // PARAMETER DETEKSI AKUMULASI BANDAR
    const THRESHOLD_SINGLE_BUY = 5000000;    // Order Beli Instan minimal Rp 5 Juta
    const THRESHOLD_ACCUMULATION = 10000000; // Total Serok Kumulatif minimal Rp 10 Juta

    const isInstantWhale = maxSingleBuyVal >= THRESHOLD_SINGLE_BUY;
    const isAccumulationWhale = totalRecentBuyVal >= THRESHOLD_ACCUMULATION && buyCount >= 2;

    if (isInstantWhale || isAccumulationWhale) {
      const timeString = latestBuyTimestamp
        ? new Date(latestBuyTimestamp).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        : new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });

      let triggerVal = isInstantWhale ? maxSingleBuyVal : totalRecentBuyVal;
      let message = isInstantWhale
        ? `Eksekusi Market BUY instan sebesar ${formatRupiah(maxSingleBuyVal)} terdeteksi!`
        : `Terdeteksi akumulasi serok total ${formatRupiah(totalRecentBuyVal)} (${buyCount} order buy)!`;

      return {
        id: pair,
        coin: `${coinName}/IDR`,
        price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
        change: `+${priceChangeFromLow.toFixed(2)}% dari Low`,
        volume: formatRupiah(total24hVol),
        rawTriggerVal: triggerVal,
        status: 'WHALE_BUY',
        message: `${message} (Harga masih murah: +${priceChangeFromLow.toFixed(1)}% dari Low)`,
        timestamp: timeString
      };
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function startScan() {
  console.log('Memulai Pemindaian Mendalam Akumulasi Paus (Sampel Maksimal)...');

  try {
    const summaryRes = await axios.get('https://indodax.com/api/summaries', { timeout: 12000 });
    const tickers = summaryRes.data.tickers;

    // Filter koin valid (Bukan stablecoin USDT/USDC, Volume 24h min Rp 30 Juta)
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
    console.log(`Pemindaian selesai! Koin terkonfirmasi: ${detectedSignals.length}`);
  } catch (error) {
    console.error('Gagal menjalankan pemindai:', error.message);
  }
}

startScan();
