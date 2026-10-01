const axios = require('axios');
const fs = require('fs');

// Fungsi untuk memformat volume agar rapi (Juta / Miliar)
function formatRupiahVolume(vol) {
  if (vol >= 1000000000) {
    return `Rp ${(vol / 1000000000).toFixed(2)} Miliar`;
  } else {
    return `Rp ${(vol / 1000000).toFixed(0)} Juta`;
  }
}

async function scan() {
  try {
    // 1. Ambil data ringkasan pasar Indodax
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
      
      // Ambil harga 24 jam lalu dari API Indodax (prices_24h)
      const rawPrevPrice = prices24h[pair];
      const prevPrice = rawPrevPrice ? parseFloat(rawPrevPrice) : lastPrice;
      
      // Hitung persentase perubahan harga asli secara presisi
      let priceChangePercent = 0;
      if (prevPrice > 0 && prevPrice !== lastPrice) {
        priceChangePercent = ((lastPrice - prevPrice) / prevPrice) * 100;
      }

      /* 
         FORMULA AKUMULASI BANDAR SANGAT PRESISI:
         1. Harga masih stagnan/murah di bawah (rentang -2.0% s/d +2.5%)
         2. Minimum volume transaksi aktif (di atas Rp 100 Juta)
      */
      const isPriceStagnant = priceChangePercent >= -2.0 && priceChangePercent <= 2.5;
      const isVolumeActive = buyVolume >= 100000000; // Threshold Rp 100 Juta

      // Kecualikan BTC agar kita fokus pada Altcoin & Meme Coin yang berpotensi pump tinggi
      if (isPriceStagnant && isVolumeActive && coinName !== 'BTC') {
        detectedSignals.push({
          id: pair,
          coin: coinName + '/IDR',
          price: `Rp ${lastPrice.toLocaleString('id-ID')}`,
          change: `${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%`,
          volume: formatRupiahVolume(buyVolume),
          rawVolume: buyVolume,
          status: 'SIAP_BELI',
          message: 'Bandar terdeteksi akumulasi diam-diam di harga murah!',
          timestamp: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        });
      }
    }

    // Urutkan koin berdasarkan transaksi volume terbesar
    detectedSignals.sort((a, b) => b.rawVolume - a.rawVolume);

    // Hapus properti pembantu sebelum disimpan ke file JSON
    const finalSignals = detectedSignals.map(({ rawVolume, ...rest }) => rest);

    fs.writeFileSync('signals.json', JSON.stringify(finalSignals, null, 2));
    console.log(`Scan selesai. Sinyal valid ditemukan: ${finalSignals.length}`);
  } catch (error) {
    console.error('Gagal memindai Indodax:', error.message);
  }
}

scan();
