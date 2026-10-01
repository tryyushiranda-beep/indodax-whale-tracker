const axios = require('axios');
const fs = require('fs');

// Format nominal Rupiah agar enak dibaca (Juta / Miliar)
function formatRupiah(amount) {
  if (amount >= 1000000000) {
    return `Rp ${(amount / 1000000000).toFixed(2)} Miliar`;
  }
  return `Rp ${(amount / 1000000).toFixed(1)} Juta`;
}

async function scanPair(pair, tickerData) {
  const coinName = pair.replace('_idr', '').toUpperCase();
  const lastPrice = parseFloat(tickerData.last);
  const total24hVol = parseFloat(tickerData.vol_idr);

  try {
    // Ambil 30 transaksi terbaru untuk analisis mendalam
    const response = await axios.get(`https://indodax.com/api/trades/${pair}`, { timeout: 4000 });
    const trades = response.data;

    if (!Array.isArray(trades) || trades.length === 0) return null;

    let totalRecentBuyVal = 0;
    let maxSingleBuyVal = 0;
    let buyCount = 0;
    let latestBuyTimestamp = null;

    for (let trade of trades.slice(0, 25)) {
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

    // PARAMETER SENSITIVITAS & AKURASI PAUS
    const THRESHOLD_SINGLE_BUY = 15000000; // Minimal 1x Instant Buy Rp 15 Juta
    const THRESHOLD_ACCUMULATION = 25000000; // Minimal Total Serok Rp 25 Juta

    const isInstantWhale = maxSingleBuyVal >= THRESHOLD_SINGLE_BUY;
    const isAccumulationWhale = totalRecentBuyVal >= THRESHOLD_ACCUMULATION && buyCount >= 2;

    if (isInstantWhale || isAccumulationWhale) {
      const timeString = latestBuyTimestamp
        ? new Date(latestBuyTimestamp).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        : new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });

      let signalType = '';
      let message = '';
      let triggerVal = 0;

      if (isInstantWhale && maxSingleBuyVal >= totalRecentBuyVal * 0.7) {
        signalType = 'WHALE_INSTANT_BUY';
        triggerVal = maxSingleBuyVal;
        message = `Paus melakukan Market BUY instan sebesar ${formatRupiah(maxSingleBuyVal)}!`;
      } else {
        signalType = 'WHALE_SEROK';
        triggerVal = totalRecentBuyVal;
        message = `Terdeteksi akumulasi serok halus total ${formatRupiah(totalRecentBuyVal)} (${buyCount} transaksi buy)!`;
      }

      return {
        id: pair,
        coin: `${coinName}/IDR`,
        price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
        change: `${formatRupiah(triggerVal)}`,
        volume: formatRupiah(total24hVol),
        rawTriggerVal: triggerVal,
        status: 'WHALE_BUY',
        message: message,
        timestamp: timeString
      };
    }
  } catch (err) {
    // Abaikan jika terjadi timeout/rate limit ringan pada koin tertentu
    return null;
  }
  return null;
}

async function startScan() {
  console.log('Memulai Pemindaian Paus Indodax Akurat...');

  try {
    const summaryRes = await axios.get('https://indodax.com/api/summaries', { timeout: 6000 });
    const tickers = summaryRes.data.tickers;

    // Filter koin valid (Bukan stablecoin & Volume 24j harian min Rp 100 Juta)
    const ignored = ['USDT', 'USDC'];
    const validPairs = Object.keys(tickers).filter(pair => {
      const coinName = pair.replace('_idr', '').toUpperCase();
      const vol24h = parseFloat(tickers[pair].vol_idr);
      return pair.endsWith('_idr') && !ignored.includes(coinName) && vol24h >= 100000000;
    });

    // Jalankan pemindaian secara paralel (eksekusi cepat agar data akurat)
    const scanPromises = validPairs.map(pair => scanPair(pair, tickers[pair]));
    const results = await Promise.all(scanPromises);

    // Filter hasil null dan urutkan dari transaksi paus terbesar
    const detectedSignals = results
      .filter(item => item !== null)
      .sort((a, b) => b.rawTriggerVal - a.rawTriggerVal)
      .map(({ rawTriggerVal, ...rest }) => rest);

    fs.writeFileSync('signals.json', JSON.stringify(detectedSignals, null, 2));
    console.log(`Pemindaian selesai! Sinyal paus terkonfirmasi: ${detectedSignals.length}`);
  } catch (error) {
    console.error('Gagal menjalankan pemindai:', error.message);
  }
}

startScan();
