// Netlify Function: POST /api/translate
// Environment variables (Netlify → Site configuration → Environment variables):
//   ANTHROPIC_API_KEY  — required, your key from console.anthropic.com
//   ACCESS_CODE        — optional, a password so strangers can't spend your credits
//   ANTHROPIC_MODEL    — optional, defaults to claude-sonnet-5-5

const NAMES = { ru: "Russian", ko: "Korean" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const SYSTEM = (from, to) => `You are an expert ${NAMES[from]}–${NAMES[to]} translator and editor.
The input is ${NAMES[from]} text written or dictated by a non-perfect speaker. It may contain typos, grammar mistakes, missing punctuation, wrong word forms, slang, or speech-recognition errors.

Do three steps:
1. "corrected": rewrite the input in ${NAMES[from]} with EVERY error fixed (spelling, grammar, case endings, word order, punctuation, words misheard by speech recognition). Infer the intended meaning. Keep the original meaning and tone; do not add or remove information.
2. "translation": translate the corrected text into ${NAMES[to]} by meaning, the way a native speaker would say it. Reorder words and choose natural idioms; never translate word for word.${to === "ko" ? " Use polite 해요체 unless the text is clearly very formal or very casual." : ""}
3. "back": translate your "translation" back into ${NAMES[from]} as faithfully as possible, so the user can see exactly how the translation reads. Do not just copy "corrected".

Answer with ONLY a JSON object: {"corrected": "...", "translation": "...", "back": "..."}. No markdown, no comments.`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const access = process.env.ACCESS_CODE;
  if (access && req.headers.get("x-access-code") !== access) {
    return json({ error: "Неверный код доступа." }, 401);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "На сервере не задан ANTHROPIC_API_KEY." }, 500);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Некорректный запрос." }, 400);
  }

  const { text, from, to } = payload || {};
  if (!NAMES[from] || !NAMES[to] || from === to) {
    return json({ error: "Некорректное направление перевода." }, 400);
  }
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Введите текст." }, 400);
  }
  if (text.length > 3000) {
    return json({ error: "Текст слишком длинный (максимум 3000 символов)." }, 400);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2000,
        system: SYSTEM(from, to),
        messages: [{ role: "user", content: text.trim() }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Anthropic API error", res.status, detail);
      return json({ error: "Ошибка ИИ-сервиса (" + res.status + "). Проверьте ключ и баланс." }, 502);
    }

    const data = await res.json();
    const raw = (data.content || []).map((b) => b.text || "").join("");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));

    return json({
      corrected: String(parsed.corrected ?? ""),
      translation: String(parsed.translation ?? ""),
      back: String(parsed.back ?? ""),
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Не удалось получить перевод. Попробуйте ещё раз." }, 500);
  }
};

export const config = { path: "/api/translate" };
