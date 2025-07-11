// /netlify/functions/callGemini.js

// CommonJS形式でライブラリを読み込みます
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// プロンプトテキストからURLを抜き出すヘルパー関数
const extractUrlFromPrompt = (prompt) => {
    const urlRegex = /## 参考URL\n(https?:\/\/[^\s]+)/;
    const match = prompt.match(urlRegex);
    return match ? match[1] : null;
};

exports.handler = async function(event) {
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  
  let requestPayload;
  try {
      requestPayload = JSON.parse(event.body);
  } catch(e) {
      return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON body" }) };
  }

  let originalPrompt = requestPayload.contents[0].parts[0].text;
  let finalPrompt = originalPrompt;

  const adUrl = extractUrlFromPrompt(originalPrompt);

  if (adUrl) {
    try {
      const response = await fetch(adUrl, { timeout: 5000 }); 
      if (response.ok) {
        const html = await response.text();
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header').remove();
        const pageText = $('body').text().replace(/\s\s+/g, ' ').trim().slice(0, 4000); 
        
        if (pageText) {
          finalPrompt += `\n\n## 参考URLのページ内容の抜粋\n${pageText}`;
        }
      }
    } catch (fetchError) {
      console.error(`URL fetch error for ${adUrl}:`, fetchError.message);
    }
  }

  requestPayload.contents[0].parts[0].text = finalPrompt;

  try {
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text();
      return {
        statusCode: geminiResponse.status,
        body: errorData,
      };
    }

    const data = await geminiResponse.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error: ' + error.message }),
    };
  }
};