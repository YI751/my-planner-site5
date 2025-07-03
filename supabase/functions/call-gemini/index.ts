// /supabase/functions/call-gemini/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as cheerio from 'https://esm.sh/cheerio@1.0.0-rc.12';

// CORSヘッダーを設定します。これにより、NetlifyのサイトからこのFunctionを呼び出せるようになります。
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // 本番環境では特定のドメインに制限することを推奨します
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// プロンプトテキストからURLを抜き出すヘルパー関数
const extractUrlFromPrompt = (prompt: string): string | null => {
    const urlRegex = /## 参考URL\n(https?:\/\/[^\s]+)/;
    const match = prompt.match(urlRegex);
    return match ? match[1] : null;
};

serve(async (req) => {
  // CORSのプリフライトリクエストに対応します。
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Supabaseクライアントを初期化して、ユーザー認証を確認します。
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user } } = await supabaseClient.auth.getUser();

    // ユーザーが認証されていない場合はエラーを返します。
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // リクエストボディ（フロントエンドから送られてきたデータ）を取得します。
    const requestPayload = await req.json();
    const originalPrompt = requestPayload.contents[0].parts[0].text;
    let finalPrompt = originalPrompt;

    // プロンプトからURLを抽出します。
    const adUrl = extractUrlFromPrompt(originalPrompt);

    // URLがあれば、そのページの内容を取得してプロンプトに追加します。
    if (adUrl) {
      try {
        const response = await fetch(adUrl, { signal: AbortSignal.timeout(5000) });
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
        // URLの取得に失敗しても、エラーにはせず続行します。
      }
    }

    // 最終的なプロンプトをセットします。
    requestPayload.contents[0].parts[0].text = finalPrompt;

    // Gemini APIを呼び出します。
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const data = await geminiResponse.json();

    // 成功した結果をフロントエンドに返します。
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // 何かエラーが発生した場合
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})