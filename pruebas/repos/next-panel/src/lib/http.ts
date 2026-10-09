import { NextResponse } from "next/server";
import { z } from "zod";

export function ok(datos: unknown, status = 200) {
  return NextResponse.json(datos, { status });
}

export function fallo(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status });
}

export async function leerCuerpo<T extends z.ZodTypeAny>(req: Request, esquema: T) {
  const r = esquema.safeParse(await req.json());
  return r.success ? { datos: r.data } : { error: fallo("Datos inválidos", 422) };
}

export function inicioDelDia(desplazamiento = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + desplazamiento);
  return d;
}
