async function searchWeb(query) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    let html = '';
    
    try {
      const axios = require('axios');
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
        },
        timeout: 8000
      });
      html = res.data;
    } catch(e) {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
        }
      });
      html = await res.text();
    }
    const linkRegex = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      links.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim()
      });
    }

    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim());
    }

    const results = [];
    const count = Math.min(links.length, 5);
    for (let i = 0; i < count; i++) {
      results.push(`نتيجة ${i + 1}:\nالعنوان: ${links[i].title}\nالملخص: ${snippets[i] || 'لا يوجد ملخص'}\n`);
    }

    return results.length > 0 ? results.join('\n---\n') : 'لم يتم العثور على نتائج بحث.';
  } catch (err) {
    return 'فشل البحث: ' + err.message;
  }
}

searchWeb('سعر الذهب اليوم في مصر').then(console.log);
