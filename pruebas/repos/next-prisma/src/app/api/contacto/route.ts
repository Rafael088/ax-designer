// Sin esquema zod ni un modelo de Prisma que se llame como el recurso: el cuerpo se envía tal cual
// y el contrato lo dice en sus notas.
export async function POST(request: Request) {
  const datos = await request.json();
  return Response.json({ data: datos, error: null }, { status: 201 });
}
