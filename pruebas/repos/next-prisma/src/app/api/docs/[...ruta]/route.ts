export async function GET(_request: Request, context: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await context.params;
  return Response.json({ data: ruta.join("/"), error: null });
}
