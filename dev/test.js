export async function GET() {
  return new Response(
    JSON.stringify({ status: "API funcionando correctamente 🚀" }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}
