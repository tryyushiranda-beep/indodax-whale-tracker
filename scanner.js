const axios = require('axios');
const fs = require('fs');

// Memformat volume menjadi Rp Juta / Rp Miliar
function formatRupiahVolume(vol) {
  if (vol >= 1000000000) {
    return `Rp ${(vol / 1000000000).toFixed(2)} Miliar`;
  } else {
    return `Rp ${(vol / 1000000).toFixed(0)} Juta`;
  }
}

async function scan() {
  try {
    const response = await axios.get('https://indodax.com/api/summaries');
    const tickers = response.data.tickers;

    let detectedSignals = [];

    // Daftar stablecoin/koin acuan yang ingin diabaikan
    const ignoredCoins = ['USDT', 'USDC', 'BTC'];

    for (let pair in tickers) {
      if (!pair.endsWith('_idr')) continue;

      const coinData = tickers[pair];
      const coinName = pair.replace('_idr', '').toUpperCase();
      
      if (ignoredCoins.includes(coinName)) continue;

      const lastPrice = parseFloat(coinData.last);
      const lowPrice = parseFloat(coinData.low);
      const highPrice = parseFloat(coinData.high);
      const buyVolume = parseFloat(coinData.vol_idr);

      // Menghitung estimasi persentase posisi harga saat ini terhadap rentang harian (Low ke High)
      // Jika harga saat ini dekat dengan harga terendah (low), persentase pergerakan akan akurat
      let priceChangePercent = 0;
      if (lowPrice > 0 && highPrice > lowPrice) {
        priceChangePercent = ((lastPrice - lowPrice) / lowPrice) * 100;
      } else if (coinData.server_time) {
        // Alternatif kalkulasi berbasis selisih harga terendah
        priceChangePercent = lowPrice > 0 ? ((lastPrice - lowPrice) / lowPrice) * 100 : 0;
      }

      /* 
         KRITERIA DETEKSI AKUMULASI (PRE-PUMP):
         1. Harga belum melonjak tinggi dari harga terendah harian (0% s/d 3.5%)
         2. Volume transaksi aktif minimal Rp 100 Juta
      */
      const isPriceStagnant = priceChangePercent >= 0.0 && priceChangePercent <= 3.5;
      const isVolumeActive = buyVolume >= 100000000;

      if (isPriceStagnant && isVolumeActive) {
        detectedSignals.push({
          id: pair,
          coin: coinName + '/IDR',
          price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
          change: `+${priceChangePercent.toFixed(2)}% dari Low`,
          volume: formatRupiahVolume(buyVolume),
          rawVolume: buyVolume,
          status: 'SIAP_BELI',
          message: 'Harga masih dekat dengan terendah harian (Low) dengan volume aktif!',
          timestamp: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        });
      }
    }

    // Urutkan koin berdasarkan volume terbesar
    detectedSignals.sort((a, b) => b.rawVolume - a.rawVolume);

    const finalSignals = detectedSignals.map(({ rawVolume, ...rest }) => rest);

    fs.writeFileSync('signals.json', JSON.stringify(finalSignals, null, 2));
    console.log(`Scan selesai. Sinyal ditemukan: ${finalSignals.length}`);
  } catch (error) {
    console.error('Gagal memindai Indodax:', error.message);
  }
}

scan();
