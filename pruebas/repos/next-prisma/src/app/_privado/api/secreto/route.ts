// Una carpeta _privada no es parte del enrutado de Next: esto no es una ruta.
export async function GET() {
  return Response.json({ secreto: true });
}
