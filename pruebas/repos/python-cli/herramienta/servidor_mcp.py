from fastmcp import FastMCP

mcp = FastMCP("herramienta")


@mcp.tool()
def buscar(texto: str) -> list:
    return []


@mcp.tool(name="leer-tarea")
def leer_tarea(id: str) -> dict:
    return {}
