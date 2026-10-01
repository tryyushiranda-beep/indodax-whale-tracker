const axios = require('axios');
const fs = require('fs');

async function scan() {
  try {
    const response = await axios.get('https://indodax.com/api/summaries');
    const tickers = response.data.tickers;
    const prices24h = response.data.prices_24h;

    let detectedSignals = [];

    for (let pair in tickers) {
      if (!pair.endsWith('_idr')) continue;

      const coinData = tickers[pair];
      const coinName = pair.replace('_idr', '').toUpperCase();
      
      const lastPrice = parseFloat(coinData.last);
      const buyVolume = parseFloat(coinData.vol_idr);
      const prevPrice = parseFloat(prices24h[pair] || lastPrice);
      
      const priceChangePercent = ((lastPrice - prevPrice) / prevPrice) * 100;

      // FORMULA DETEKSI AKUMULASI BANDAR (PRE-PUMP)
      const isPriceStagnant = priceChangePercent >= -2.0 && priceChangePercent <= 3.0;
      const isVolumeActive = buyVolume >= 50000000; // Minimal transaksi Rp 50 Juta

      if (isPriceStagnant && isVolumeActive) {
        detectedSignals.push({
          id: pair,
          coin: coinName + '/IDR',
          price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
          change: `${priceChangePercent.toFixed(2)}%`,
          volume: `Rp ${(buyVolume / 1000000).toFixed(0)} Juta`,
          status: 'SIAP_BELI',
          message: 'Bandar terdeteksi akumulasi diam-diam di harga bawah!',
          timestamp: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        });
      }
    }

    fs.writeFileSync('signals.json', JSON.stringify(detectedSignals, null, 2));
    console.log(`Scan selesai. Sinyal ditemukan: ${detectedSignals.length}`);
  } catch (error) {
    console.error('Gagal memindai Indodax:', error.message);
  }
}

scan();
