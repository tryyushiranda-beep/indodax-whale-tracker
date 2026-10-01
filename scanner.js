const axios = require('axios');
const fs = require('fs');

function formatRupiahVolume(vol) {
  if (vol >= 1000000000) {
    return `Rp ${(vol / 1000000000).toFixed(2)} Miliar`;
  } else {
    return `Rp ${(vol / 1000000).toFixed(0)} Juta`;
  }
}

async function scan() {
  try {
    const summaryRes = await axios.get('https://indodax.com/api/summaries');
    const tickers = summaryRes.data.tickers;

    let whaleSignals = [];
    const ignoredCoins = ['USDT', 'USDC', 'BTC'];

    // Ambil daftar pair aktif dengan volume memadai
    const pairs = Object.keys(tickers).filter(pair => {
      const coinName = pair.replace('_idr', '').toUpperCase();
      return pair.endsWith('_idr') && !ignoredCoins.includes(coinName) && parseFloat(tickers[pair].vol_idr) >= 100000000;
    });

    // Pindai riwayat transaksi terbaru (trade history) untuk setiap pair
    for (let pair of pairs) {
      const coinName = pair.replace('_idr', '').toUpperCase();
      const lastPrice = parseFloat(tickers[pair].last);

      try {
        const tradeRes = await axios.get(`https://indodax.com/api/trades/${pair}`);
        const trades = tradeRes.data;

        if (Array.isArray(trades)) {
          // Filter transaksi jenis 'buy' bernilai tunggal besar (misal >= Rp 25 Juta dalam 1 transaksi)
          const WHALE_THRESHOLD_IDR = 25000000; 

          for (let trade of trades.slice(0, 15)) { // Cek 15 transaksi terakhir
            const price = parseFloat(trade.price);
            const amountCoin = parseFloat(trade.amount);
            const totalValueIDR = price * amountCoin;

            if (trade.type === 'buy' && totalValueIDR >= WHALE_THRESHOLD_IDR) {
              whaleSignals.push({
                id: pair,
                coin: coinName + '/IDR',
                price: `Rp ${price.toLocaleString('id-ID')}`,
                change: `Order Jumbo: ${formatRupiahVolume(totalValueIDR)}`,
                volume: formatRupiahVolume(parseFloat(tickers[pair].vol_idr)),
                rawVal: totalValueIDR,
                status: 'WHALE_BUY',
                message: `Paus melakukan BUY instan senilai ${formatRupiahVolume(totalValueIDR)} di harga Rp ${price.toLocaleString('id-ID')}!`,
                timestamp: new Date(parseInt(trade.date) * 1000).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
              });
            }
          }
        }
      } catch (e) {
        // Abaikan error rate limit per pair
      }
    }

    // Urutkan sinyal berdasarkan nilai transaksi paus terbesar
    whaleSignals.sort((a, b) => b.rawVal - a.rawVal);

    // Hilangkan duplikasi pair dan ambil sinyal paus terbesar
    const uniqueSignals = [];
    const seenPairs = new Set();
    for (let item of whaleSignals) {
      if (!seenPairs.has(item.id)) {
        seenPairs.add(item.id);
        const { rawVal, ...rest } = item;
        uniqueSignals.push(rest);
      }
    }

    fs.writeFileSync('signals.json', JSON.stringify(uniqueSignals, null, 2));
    console.log(`Scan selesai. Eksekusi paus ditemukan: ${uniqueSignals.length}`);
  } catch (error) {
    console.error('Gagal memindai transaksi paus:', error.message);
  }
}

scan();
