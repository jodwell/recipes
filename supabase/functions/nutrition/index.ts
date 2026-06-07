// Supabase Edge Function: nutrition
// -----------------------------------------------------------------------------
// Takes a recipe's ingredient lines and returns total calories + macros by
// calling the Edamam Nutrition Analysis API. Running this server-side keeps the
// Edamam credentials secret and avoids browser CORS issues.
//
// Deploy:
//   supabase functions deploy nutrition
// Set secrets (get free credentials at https://developer.edamam.com -> Nutrition Analysis API):
//   supabase secrets set EDAMAM_APP_ID=xxxx EDAMAM_APP_KEY=yyyy
//
// The browser calls it via:  supabase.functions.invoke('nutrition', { body })
// -----------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const APP_ID = Deno.env.get("EDAMAM_APP_ID");
    const APP_KEY = Deno.env.get("EDAMAM_APP_KEY");
    if (!APP_ID || !APP_KEY) {
      return json(
        { error: "Edamam credentials are not configured on the server." },
        500,
      );
    }

    const { title, ingredients } = await req.json();
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return json({ error: "No ingredients provided." }, 400);
    }

    const url =
      `https://api.edamam.com/api/nutrition-details?app_id=${APP_ID}&app_key=${APP_KEY}`;

    const edamamRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || "Recipe",
        ingr: ingredients,
      }),
    });

    if (!edamamRes.ok) {
      const detail = await edamamRes.text();
      return json(
        {
          error:
            "Could not analyse these ingredients. Make sure each has a quantity (e.g. '200 g chicken').",
          status: edamamRes.status,
          detail,
        },
        502,
      );
    }

    const data = await edamamRes.json();
    const n = data.totalNutrients || {};
    const round = (v: number | undefined) =>
      v === undefined ? null : Math.round(v);

    // Totals for the whole recipe (the client divides by servings for per-serving values)
    return json({
      calories: round(data.calories),
      protein: round(n.PROCNT?.quantity),
      carbs: round(n.CHOCDF?.quantity),
      fat: round(n.FAT?.quantity),
    });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
