import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Sin esquema zod: el contrato saca el cuerpo del modelo Orden de Prisma (@@map("ordenes")).
export async function POST(request: Request) {
  const datos = await request.json();
  const orden = await prisma.orden.create({ data: datos });
  return NextResponse.json({ data: orden, error: null }, { status: 201 });
}
