// Plantilla de ax/cli.py: el mismo CLI que ax/cli.mjs para un repo de Python, solo con la
// biblioteca estándar (python3). Los datos del repo entran como un literal de texto JSON que
// json.loads lee (un texto JSON es un literal válido de Python); el código es fijo, en String.raw
// para que las barras invertidas lleguen tal cual: no lleva comillas invertidas ni `${`.
import type { DatosDelCli } from "./datos.ts";

export function plantillaCliPython(datos: DatosDelCli): string {
  return CABEZA + "DATOS = json.loads(" + JSON.stringify(JSON.stringify(datos)) + ")\n" + CUERPO;
}

const CABEZA = String.raw`#!/usr/bin/env python3
# El CLI de AX de este repo: un verbo por verbo del contrato (ax/contrato.json), cada uno sobre el
# estado del dominio. JSON por stdout con "esquema": 1, también los errores (error, salida,
# reintentable). Códigos: 0 bien, 2 uso, 3 error, 4 el estado cambió desde la huella, 5 hace
# falta una persona. Las escrituras son un ensayo hasta --aplicar; con --huella salen con 4 si el
# estado cambió desde esa lectura. Las transiciones vedadas no son verbos. Los verbos HTTP llaman a
# la API del repo en la URL base del contrato (http.base_url: su variable de entorno o el valor por
# defecto). Sin dependencias: solo la biblioteca estándar. Para cambiarlo, cambia el contrato y vuelve a generar.
import csv
import datetime
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

`;

const CUERPO = String.raw`
RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), DATOS["hasta_la_raiz"]))
PROGRAMA = DATOS["programa"]
CARACTERES_POR_TOKEN = 4
MAX_IDS = 20
ULTIMOS = 3


class Fallo(Exception):
    def __init__(self, codigo, error, salida, reintentable=False, datos=None):
        super().__init__(error)
        self.codigo = codigo
        self.error = error
        self.salida = salida
        self.reintentable = reintentable
        self.datos = datos or {}


def uso(error, verbo=None):
    if verbo is not None:
        salida = "Corrige las entradas de «" + verbo["nombre"] + "» (míralas con «" + PROGRAMA + " --help») y vuelve a llamarlo."
    else:
        salida = "Mira los verbos con «" + PROGRAMA + " --help»."
    return Fallo(2, error, salida)


def relee():
    if DATOS["relectura"]:
        return "Vuelve a leer con «" + PROGRAMA + " " + DATOS["relectura"] + "», ensaya otra vez con la huella nueva y luego aplica."
    return "Vuelve a leer el estado, ensaya otra vez con la huella nueva y luego aplica."


def a_json(valor):
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":"))


def json_canonico(valor):
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256(datos):
    return hashlib.sha256(datos).hexdigest()


def tokens(texto):
    return int(round(len(texto) / CARACTERES_POR_TOKEN))


def es_objeto(v):
    return isinstance(v, dict)


# --- argv: verbo, posicionales en orden, --bandera=valor, booleanos solos ---

def parsear(verbo, argv):
    valores = {}
    posicionales = []
    for arg in argv:
        if arg.startswith("--"):
            bandera, igual_, texto = arg.partition("=")
            entrada = next((e for e in verbo["entradas"] if e["como"] == "bandera" and e.get("bandera") == bandera), None)
            if entrada is None:
                raise uso("«" + bandera + "» no es una bandera de «" + verbo["nombre"] + "».", verbo)
            if entrada["tipo"] == "booleano":
                if igual_:
                    raise uso("«" + bandera + "» es un booleano: va sola, sin «=valor».", verbo)
                valores[entrada["nombre"]] = True
                continue
            if not igual_:
                raise uso("«" + bandera + "» necesita un valor: escríbelo como «" + bandera + "=valor», sin espacio.", verbo)
            if entrada["tipo"] == "lista":
                valores.setdefault(entrada["nombre"], []).append(texto)
                continue
            if entrada["nombre"] in valores:
                raise uso("«" + bandera + "» va una sola vez.", verbo)
            if entrada["tipo"] == "entero":
                if not re.fullmatch(r"-?\d+", texto):
                    raise uso("«" + bandera + "» tiene que ser un entero.", verbo)
                valores[entrada["nombre"]] = int(texto)
            else:
                valores[entrada["nombre"]] = texto
        elif arg.startswith("-"):
            raise uso("«" + arg + "» no es una entrada: las banderas llevan dos guiones y los posicionales no empiezan por «-».", verbo)
        else:
            posicionales.append(arg)
    esperados = sorted((e for e in verbo["entradas"] if e["como"] == "posicional"), key=lambda e: e["posicion"])
    if len(posicionales) > len(esperados):
        raise uso("«" + verbo["nombre"] + "» recibe " + str(len(esperados)) + " posicional(es) y llegaron " + str(len(posicionales)) + ".", verbo)
    for e, valor in zip(esperados, posicionales):
        valores[e["nombre"]] = valor
    for e in verbo["entradas"]:
        if e["requerida"] and valores.get(e["nombre"]) in (None, ""):
            raise uso("Falta «" + e["nombre"] + "»: " + e["descripcion"], verbo)
    return valores


# --- el estado del dominio ---

def leer_fuente(fuente):
    leida = dict(fuente)
    try:
        with open(os.path.join(RAIZ, fuente["ruta"]), "rb") as f:
            datos = f.read()
    except FileNotFoundError:
        leida.update(existe=False, sha256=None, datos=None)
        return leida
    except OSError as e:
        raise Fallo(3, "No se pudo leer " + fuente["ruta"] + ": " + str(e), "Revisa los permisos de " + fuente["ruta"] + "; si se repite igual, avisa a una persona con este mensaje.")
    leida.update(existe=True, sha256=sha256(datos), datos=datos)
    return leida


def leer_dominio():
    return [leer_fuente(f) for f in DATOS["fuentes"]]


def huella_de(leidas):
    """sha256 del JSON canónico de [ruta, sha256 o null] de cada fuente, en orden de ruta (ax/contrato.json, dominio.huella)."""
    pares = sorted(([l["ruta"], l["sha256"]] for l in leidas), key=lambda p: p[0])
    return sha256(json_canonico(pares).encode("utf-8"))


def texto_de(leida):
    texto = leida["datos"].decode("utf-8")
    return texto[1:] if texto.startswith("﻿") else texto


def ilegible(leida, detalle):
    return Fallo(3, leida["ruta"] + " no se puede leer como " + leida["formato"] + ": " + detalle, "Hay que revisarlo a mano: no lo reescribas desde el agente; avisa a una persona con este mensaje.")


def parsear_csv(texto):
    filas = [f for f in csv.reader(io.StringIO(texto)) if f != [] and f != [""]]
    if not filas:
        return [], []
    columnas, resto = filas[0], filas[1:]
    return columnas, [{c: (f[i] if i < len(f) else "") for i, c in enumerate(columnas)} for f in resto]


def lineas_jsonl(leida):
    registros = []
    for i, linea in enumerate(texto_de(leida).split("\n")):
        if linea.strip() == "":
            continue
        try:
            registros.append(json.loads(linea))
        except ValueError as e:
            raise ilegible(leida, "la línea " + str(i + 1) + " no es JSON (" + str(e) + ")")
    return registros


def registros_de(leida):
    """Los registros de una fuente: la lista raíz o la primera lista de primer nivel (JSON), cada línea (JSONL) o cada fila (CSV)."""
    if not leida["existe"]:
        raise Fallo(3, "No existe " + leida["ruta"] + ".", "El estado del dominio no está donde dice el contrato: revisa la ruta o vuelve a generar con «axd generar cli».")
    formato = leida["formato"]
    if formato == "json":
        try:
            valor = json.loads(texto_de(leida))
        except ValueError as e:
            raise ilegible(leida, str(e))
        if isinstance(valor, list):
            return valor
        if es_objeto(valor):
            for clave, v in valor.items():
                if isinstance(v, list):
                    return v
        raise ilegible(leida, "no tiene una lista de registros (ni en la raíz ni en una clave de primer nivel)")
    if formato == "jsonl":
        return lineas_jsonl(leida)
    if formato == "csv":
        return parsear_csv(texto_de(leida))[1]
    raise ilegible(leida, "el CLI solo lee registros de JSON, JSONL y CSV")


def ids_de(registros):
    ids = [str(r["id"]) if not isinstance(r["id"], str) else r["id"] for r in registros if es_objeto(r) and r.get("id") is not None]
    return ids[:MAX_IDS] if ids else None


def resumen_de_fuente(leida):
    r = {"ruta": leida["ruta"], "formato": leida["formato"], "existe": leida["existe"]}
    if not leida["existe"]:
        return r
    r["bytes"] = len(leida["datos"])
    formato = leida["formato"]
    try:
        if formato == "json":
            valor = json.loads(texto_de(leida))
            if isinstance(valor, list):
                r["registros"] = len(valor)
                if valor and es_objeto(valor[0]):
                    r["claves"] = list(valor[0].keys())
                r["ids"] = ids_de(valor)
            elif es_objeto(valor):
                r["claves"] = list(valor.keys())
                colecciones = [k for k, v in valor.items() if isinstance(v, list)]
                if colecciones:
                    r["colecciones"] = {k: len(valor[k]) for k in colecciones}
                    r["ids"] = ids_de(valor[colecciones[0]])
        elif formato == "jsonl":
            registros = lineas_jsonl(leida)
            r["registros"] = len(registros)
            claves = []
            for x in registros[:20]:
                if es_objeto(x):
                    claves.extend(k for k in x.keys() if k not in claves)
            r["claves"] = claves
            r["ultimos"] = registros[-ULTIMOS:]
        elif formato == "csv":
            columnas, registros = parsear_csv(texto_de(leida))
            r["registros"] = len(registros)
            r["columnas"] = columnas
            r["ids"] = ids_de(registros)
        elif formato != "sqlite":
            texto = texto_de(leida)
            r["lineas"] = len([l for l in texto.split("\n") if l.strip() != ""])
            if formato == "yaml":
                claves = []
                for m in re.finditer(r"^([\w-]+)\s*:", texto, re.MULTILINE):
                    if m.group(1) not in claves:
                        claves.append(m.group(1))
                r["claves"] = claves
            r["nota"] = "Formato sin lector en la biblioteca estándar: se resume por líneas."
        else:
            r["nota"] = "Base de datos binaria: solo se informa su tamaño."
    except Fallo as e:
        r["error"] = e.error
    except (ValueError, UnicodeDecodeError) as e:
        r["error"] = str(e)
    if r.get("ids", 0) is None:
        del r["ids"]
    return r


def ajustar(cuerpo, recortes):
    """Aplica recortes en orden hasta que la salida cabe en el presupuesto; marca truncado si recortó algo."""
    for recortar in recortes:
        if tokens(a_json(cuerpo)) <= cuerpo["presupuesto_tokens"]:
            return cuerpo
        if recortar(cuerpo):
            cuerpo["truncado"] = True
    return cuerpo


def recortes_del_resumen(fuentes):
    def cada_una(f):
        def recortar(_cuerpo):
            hubo = False
            for x in fuentes:
                hubo = f(x) or hubo
            return hubo
        return recortar

    def acortar(clave, n):
        def f(x):
            if clave in x and len(x[clave]) > n:
                x[clave] = x[clave][-n:] if clave == "ultimos" else x[clave][:n]
                return True
            return False
        return f

    def quitar(clave):
        def f(x):
            if clave in x:
                del x[clave]
                return True
            return False
        return f

    return [cada_una(acortar("ultimos", 1)), cada_una(quitar("ultimos")), cada_una(acortar("ids", 5)), cada_una(quitar("ids")),
            cada_una(acortar("claves", 10)), cada_una(acortar("columnas", 10)), cada_una(quitar("colecciones"))]


def resumen_del_dominio(leidas, presupuesto):
    fuentes = [resumen_de_fuente(l) for l in leidas]
    return ajustar({"fuentes": fuentes, "presupuesto_tokens": presupuesto, "truncado": False}, recortes_del_resumen(fuentes))


def ajustar_registros(cuerpo):
    for _ in range(200):
        if tokens(a_json(cuerpo)) <= cuerpo["presupuesto_tokens"] or not cuerpo["registros"]:
            break
        cuerpo["registros"] = cuerpo["registros"][: int(len(cuerpo["registros"]) * 0.8)]
        cuerpo["mostrados"] = len(cuerpo["registros"])
        cuerpo["truncado"] = True
    if cuerpo["truncado"]:
        cuerpo["salida"] = "Hay " + str(cuerpo["total"]) + " y se muestran " + str(cuerpo["mostrados"]) + " para no pasar de " + str(cuerpo["presupuesto_tokens"]) + " tokens: acota con los filtros del verbo."
    return cuerpo


def coleccion(leidas, ruta):
    leida = next((l for l in leidas if l["ruta"] == ruta), None)
    if leida is None:
        raise Fallo(3, "El contrato no declara " + ruta + " como fuente del dominio.", "Es un fallo del CLI generado: vuelve a generarlo con «axd generar cli --aplicar».")
    return registros_de(leida)


def como_texto(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return a_json(v)
    return str(v)


def igual(registro, campo, valor):
    return es_objeto(registro) and registro.get(campo) is not None and como_texto(registro[campo]) == como_texto(valor)


# --- los verbos ---

def hacer_resumen(verbo):
    leidas = leer_dominio()
    cuerpo = {"esquema": 1, "verbo": verbo["nombre"], "huella": huella_de(leidas)}
    cuerpo.update(resumen_del_dominio(leidas, verbo["presupuesto_tokens"]))
    if cuerpo["truncado"]:
        cuerpo["salida"] = "Recortado para no pasar de " + str(cuerpo["presupuesto_tokens"]) + " tokens: usa las lecturas acotadas para el detalle."
    return cuerpo


def hacer_listar(verbo, valores):
    impl = verbo["implementacion"]
    leidas = leer_dominio()
    filtros = {f: valores[f] for f in impl["filtros"] if f in valores}
    elegidos = [r for r in coleccion(leidas, impl["coleccion"]) if all(igual(r, f, v) for f, v in filtros.items())]
    cuerpo = {"esquema": 1, "verbo": verbo["nombre"], "coleccion": impl["coleccion"], "huella": huella_de(leidas), "filtros": filtros,
              "total": len(elegidos), "mostrados": len(elegidos), "registros": elegidos, "presupuesto_tokens": verbo["presupuesto_tokens"], "truncado": False}
    return ajustar_registros(cuerpo)


def hacer_buscar(verbo, valores):
    impl = verbo["implementacion"]
    leidas = leer_dominio()
    texto = str(valores.get(impl["entrada"], "")).lower()
    if texto == "":
        raise uso("Falta el texto que buscar en «" + impl["entrada"] + "».", verbo)
    elegidos = [r for r in coleccion(leidas, impl["coleccion"]) if texto in a_json(r).lower()]
    cuerpo = {"esquema": 1, "verbo": verbo["nombre"], "coleccion": impl["coleccion"], "huella": huella_de(leidas), "texto": valores[impl["entrada"]],
              "total": len(elegidos), "mostrados": len(elegidos), "registros": elegidos, "presupuesto_tokens": verbo["presupuesto_tokens"], "truncado": False}
    return ajustar_registros(cuerpo)


def no_esta(campo, valor, ruta):
    donde = (" Mira los que hay con «" + PROGRAMA + " " + DATOS["relectura"] + "».") if DATOS["relectura"] else ""
    return Fallo(2, "No hay ningún registro con " + campo + "=" + como_texto(valor) + " en " + ruta + ".", "Corrige «" + campo + "»." + donde)


def hacer_leer(verbo, valores):
    impl = verbo["implementacion"]
    leidas = leer_dominio()
    valor = valores.get(impl["entrada"])
    if valor is None:
        raise uso("Falta «" + impl["entrada"] + "»: dice qué registro leer.", verbo)
    registro = next((r for r in coleccion(leidas, impl["coleccion"]) if igual(r, impl["campo"], valor)), None)
    if registro is None:
        raise no_esta(impl["campo"], valor, impl["coleccion"])
    return {"esquema": 1, "verbo": verbo["nombre"], "coleccion": impl["coleccion"], "huella": huella_de(leidas), "registro": registro}


def sin_fecha(registro):
    if not es_objeto(registro):
        return json_canonico(registro)
    return json_canonico({k: v for k, v in registro.items() if k != "fecha"})


def reemplazar(ruta, texto, huella):
    """Reemplazo atómico: temporal en la misma carpeta y os.replace, solo si el dominio sigue con la huella leída."""
    destino = os.path.join(RAIZ, ruta)
    if os.path.lexists(destino) and (os.path.islink(destino) or not os.path.isfile(destino)):
        raise Fallo(5, ruta + " no es un archivo normal (¿un enlace o una carpeta?): no se escribe.", "Hace falta una persona: deja " + ruta + " como un archivo normal y vuelve a ensayar.")
    temporal = destino + ".ax-" + str(os.getpid()) + "-" + str(int(datetime.datetime.now().timestamp() * 1000)) + ".tmp"
    try:
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(temporal, "x", encoding="utf-8", newline="") as f:
            f.write(texto)
        if huella_de(leer_dominio()) != huella:
            raise Fallo(4, "El estado cambió mientras se escribía: no se escribió nada.", relee(), True)
        os.replace(temporal, destino)
    except OSError as e:
        raise Fallo(3, "No se pudo escribir " + ruta + ": " + str(e), "Revisa los permisos de " + ruta + "; si se repite igual, avisa a una persona con este mensaje.")
    finally:
        if os.path.exists(temporal):
            os.remove(temporal)


def ahora():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def hacer_anexar(verbo, valores, argv):
    impl = verbo["implementacion"]
    leidas = leer_dominio()
    huella = huella_de(leidas)
    if "huella" in valores and valores["huella"] != huella:
        raise Fallo(4, "El estado cambió desde la huella que pasaste: no se escribió nada.", relee(), True, {"huella_actual": huella})
    existe = impl.get("existe")
    if existe:
        valor = valores.get(existe["entrada"])
        if valor is not None and not any(igual(r, existe["campo"], valor) for r in coleccion(leidas, existe["coleccion"])):
            raise no_esta(existe["campo"], valor, existe["coleccion"])
    destino = next(l for l in leidas if l["ruta"] == impl["destino"])
    anteriores = lineas_jsonl(destino) if destino["existe"] else []
    registro = {"evento": impl["evento"]}
    for campo in impl["campos"]:
        if campo in valores:
            registro[campo] = valores[campo]
    registro["fecha"] = ahora()
    aplicar = valores.get("aplicar") is True
    if any(sin_fecha(r) == sin_fecha(registro) for r in anteriores):
        return {"esquema": 1, "ensayo": not aplicar, "verbo": verbo["nombre"], "cambios": [], "sin_cambios": True,
                "estado_nuevo": resumen_del_dominio(leidas, DATOS["presupuesto_del_estado_nuevo"]) if aplicar else None, "huella": huella,
                "salida": "Ya está registrado igual en " + impl["destino"] + ": no hay nada que escribir."}
    cambios = [{"ruta": impl["destino"], "accion": "anexar", "registro": registro}]
    if not aplicar:
        sin_huella = [a for a in argv if not a.startswith("--huella=") and a != "--aplicar"]
        return {"esquema": 1, "ensayo": True, "verbo": verbo["nombre"], "cambios": cambios, "estado_nuevo": None, "huella": huella,
                "para_aplicar": [verbo["nombre"]] + sin_huella + ["--aplicar", "--huella=" + huella],
                "salida": "Es un ensayo: no se escribió nada. Para escribir, repite la llamada con --aplicar --huella=" + huella + "."}
    anterior = texto_de(destino) if destino["existe"] else ""
    nuevo = anterior + ("" if anterior == "" or anterior.endswith("\n") else "\n") + a_json(registro) + "\n"
    reemplazar(impl["destino"], nuevo, huella)
    despues = leer_dominio()
    return {"esquema": 1, "ensayo": False, "verbo": verbo["nombre"], "cambios": cambios,
            "estado_nuevo": resumen_del_dominio(despues, DATOS["presupuesto_del_estado_nuevo"]),
            "huella": huella_de(despues), "huella_anterior": huella,
            "salida": "Escrito en " + impl["destino"] + ". Pasa la huella nueva a la próxima escritura."}


# --- los verbos que llaman a la API HTTP del repo ---

MAX_TEXTO = 4000


def base_url():
    config = DATOS["http"]["base_url"]
    valor = (os.environ.get(config["variable"]) or "").strip() or config["por_defecto"]
    partes = urllib.parse.urlsplit(valor)
    if partes.scheme not in ("http", "https") or not partes.netloc:
        raise Fallo(2, config["variable"] + "=" + valor + " no es una URL.", "Pon en " + config["variable"] + " la URL del servidor (p. ej. " + config["por_defecto"] + ") o quítala para usar esa.")
    return valor.rstrip("/")


def espera_ms():
    config = DATOS["http"]["espera_ms"]
    try:
        valor = float(os.environ.get(config["variable"]) or "")
    except ValueError:
        return config["por_defecto"]
    return valor if valor > 0 else config["por_defecto"]


def url_de(verbo, valores, base):
    impl = verbo["implementacion"]
    segmentos = []
    for segmento in impl["ruta"].split("/"):
        if not segmento.startswith(":"):
            segmentos.append(segmento)
            continue
        nombre = segmento[1:].rstrip("*?")
        parametro = next((p for p in impl["parametros"] if p["segmento"] == nombre), None)
        valor = valores.get(parametro["entrada"]) if parametro is not None else None
        if valor in (None, ""):
            continue
        if parametro["resto"]:
            segmentos.extend(urllib.parse.quote(x, safe="") for x in str(valor).split("/") if x != "")
        else:
            segmentos.append(urllib.parse.quote(str(valor), safe=""))
    consulta = [(q["parametro"], como_texto(valores[q["entrada"]])) for q in impl["consulta"] if valores.get(q["entrada"]) is not None]
    texto = urllib.parse.urlencode(consulta)
    return base + ("/".join(segmentos) or "/") + ("?" + texto if texto else "")


def de_tipo(valor, tipo):
    if tipo in ("texto", "fecha"):
        return isinstance(valor, str)
    if tipo == "numero":
        return isinstance(valor, (int, float)) and not isinstance(valor, bool)
    if tipo == "entero":
        return isinstance(valor, int) and not isinstance(valor, bool)
    if tipo == "booleano":
        return isinstance(valor, bool)
    if tipo == "lista":
        return isinstance(valor, list)
    if tipo == "objeto":
        return es_objeto(valor)
    return True


def cuerpo_de(verbo, valores):
    c = verbo["implementacion"]["cuerpo"]
    if not c or valores.get(c["entrada"]) is None:
        return None, []
    try:
        valor = json.loads(valores[c["entrada"]])
    except ValueError as e:
        raise uso("«--" + c["entrada"] + "» no es JSON: " + str(e), verbo)
    avisos = []
    forma = c["forma"]
    if forma:
        if not es_objeto(valor):
            raise uso("«--" + c["entrada"] + "» tiene que ser un objeto JSON con " + ", ".join(x["nombre"] + ("*" if x["requerido"] else "") for x in forma["campos"]) + " (* requerido).", verbo)
        faltan = [x for x in forma["campos"] if x["requerido"] and valor.get(x["nombre"]) is None]
        if faltan:
            raise uso("Al cuerpo le falta " + ", ".join(x["nombre"] + " (" + x["tipo"] + ")" for x in faltan) + ": lo exige " + forma["nombre"] + " (" + forma["desde"]["archivo"] + ":" + str(forma["desde"]["linea"]) + ").", verbo)
        for x in forma["campos"]:
            if valor.get(x["nombre"]) is not None and not de_tipo(valor[x["nombre"]], x["tipo"]):
                avisos.append("«" + x["nombre"] + "» debería ser " + x["tipo"] + ".")
        conocidos = set(x["nombre"] for x in forma["campos"])
        otros = [k for k in valor if k not in conocidos]
        if otros:
            avisos.append("El contrato no conoce " + ", ".join(otros) + ": se envía igual.")
    return valor, avisos


def mensaje_de(respuesta):
    if isinstance(respuesta, str):
        return respuesta[:300]
    if not es_objeto(respuesta):
        return ""
    return ": ".join(respuesta[k] for k in ("error", "message", "mensaje", "detail", "detalle") if isinstance(respuesta.get(k), str))


def fallo_http(verbo, estado, respuesta, peticion):
    datos = {"peticion": peticion, "estado": estado, "respuesta": respuesta}
    dice = mensaje_de(respuesta)
    que = peticion["metodo"] + " " + peticion["url"] + " respondió " + str(estado) + (": " + dice if dice else ".")
    variable = DATOS["http"]["base_url"]["variable"]
    if estado in (400, 422):
        return Fallo(2, que, "El servidor rechazó las entradas: corrígelas según su respuesta y el esquema del verbo (" + PROGRAMA + " --help) y vuelve a llamarlo.", False, datos)
    if estado == 404 and verbo["implementacion"]["parametros"]:
        return Fallo(2, que, "No existe lo que pide el parámetro: corrígelo (búscalo con una lectura que liste) y vuelve a llamarlo.", False, datos)
    if estado == 404:
        return Fallo(3, que, "La ruta no existe en ese servidor: comprueba que " + variable + " apunta al servidor de este repo.", False, datos)
    if estado in (401, 403):
        return Fallo(5, que, "Hace falta una persona: el servidor pide credenciales que este CLI no maneja; pídele acceso o que haga la operación.", False, datos)
    if estado in (409, 412):
        return Fallo(4, que, "El estado cambió o choca con lo que pediste: vuelve a leerlo, ensaya otra vez y luego aplica.", True, datos)
    if estado == 429 or estado >= 500:
        return Fallo(3, que, "Es del servidor: espera un poco y reintenta; si se repite igual, avisa a una persona con este mensaje.", True, datos)
    return Fallo(3, que, "Lee la respuesta del servidor; si no sabes qué hacer con ella, avisa a una persona.", False, datos)


def acotar_respuesta(cuerpo):
    presupuesto = cuerpo["presupuesto_tokens"]
    if tokens(a_json(cuerpo)) <= presupuesto:
        return cuerpo
    r = cuerpo["respuesta"]
    lista = None
    clave = None
    if isinstance(r, list):
        lista = r
    elif es_objeto(r):
        clave = next((k for k in r if isinstance(r[k], list)), None)
        if clave is not None:
            lista = r[clave]
    if lista is not None:
        n = len(lista)
        while n > 1 and tokens(a_json(cuerpo)) > presupuesto:
            n = int(n * 0.8)
            if clave is None:
                cuerpo["respuesta"] = lista[:n]
            else:
                r[clave] = lista[:n]
        cuerpo["total"] = len(lista)
        cuerpo["mostrados"] = n
        cuerpo["truncado"] = n < len(lista)
        if cuerpo["truncado"]:
            cuerpo["salida"] = "Hay " + str(len(lista)) + " y se muestran " + str(n) + " para no pasar de " + str(presupuesto) + " tokens: lee uno con su verbo de leer o acota con las entradas del verbo."
    elif isinstance(r, str):
        cuerpo["respuesta"] = r[: presupuesto * CARACTERES_POR_TOKEN]
        cuerpo["truncado"] = True
    if tokens(a_json(cuerpo)) > presupuesto:
        cuerpo["excede_presupuesto"] = True
        cuerpo.setdefault("salida", "La respuesta pasa de " + str(presupuesto) + " tokens y no tiene una lista que recortar.")
    return cuerpo


def leer_respuesta(datos):
    texto = datos.decode("utf-8", "replace")
    if texto.strip() == "":
        return None
    try:
        return json.loads(texto)
    except ValueError:
        return texto[:MAX_TEXTO]


def hacer_http(verbo, valores, argv):
    impl = verbo["implementacion"]
    url = url_de(verbo, valores, base_url())
    cuerpo, avisos = cuerpo_de(verbo, valores)
    peticion = {"metodo": impl["metodo"], "url": url}
    if cuerpo is not None:
        peticion["cuerpo"] = cuerpo
    escritura = verbo["tipo"] == "escritura"
    extra = {"avisos": avisos} if avisos else {}
    if escritura and valores.get("aplicar") is not True:
        salida = {"esquema": 1, "ensayo": True, "verbo": verbo["nombre"], "peticion": peticion, "estado": None, "respuesta": None}
        salida.update(extra)
        salida["para_aplicar"] = [verbo["nombre"]] + [a for a in argv if a != "--aplicar"] + ["--aplicar"]
        salida["salida"] = "Es un ensayo: no se hizo ninguna petición. Para hacerla, repite la llamada con --aplicar."
        return salida
    cabeceras = {"accept": "application/json"}
    datos = None
    if cuerpo is not None:
        cabeceras["content-type"] = "application/json"
        datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
    pedido = urllib.request.Request(url, data=datos, headers=cabeceras, method=impl["metodo"])
    espera = espera_ms()
    try:
        with urllib.request.urlopen(pedido, timeout=espera / 1000) as r:
            estado, respuesta = r.status, leer_respuesta(r.read())
    except urllib.error.HTTPError as e:
        raise fallo_http(verbo, e.code, leer_respuesta(e.read()), peticion)
    except (urllib.error.URLError, OSError) as e:
        causa = getattr(e, "reason", e)
        tiempo = isinstance(causa, TimeoutError) or "timed out" in str(causa)
        variable = DATOS["http"]["base_url"]["variable"]
        raise Fallo(
            3,
            (impl["metodo"] + " " + url + " no respondió en " + str(int(espera)) + " ms.") if tiempo else ("No se pudo llamar a " + impl["metodo"] + " " + url + ": " + str(causa)),
            ("Si el servidor es lento de verdad, sube " + DATOS["http"]["espera_ms"]["variable"] + "; si no, comprueba que responde y reintenta.") if tiempo
            else ("¿Está levantado el servidor? Levántalo o pon su URL en " + variable + ", y reintenta."),
            True,
            {"peticion": peticion},
        )
    salida = {"esquema": 1, "verbo": verbo["nombre"]}
    if escritura:
        salida["ensayo"] = False
    salida.update({"peticion": peticion, "estado": estado, "respuesta": respuesta})
    salida.update(extra)
    if escritura:
        return salida
    salida.update({"presupuesto_tokens": verbo["presupuesto_tokens"], "truncado": False})
    return acotar_respuesta(salida)


def sin_implementar(verbo):
    impl = verbo["implementacion"]
    raise Fallo(5, "«" + verbo["nombre"] + "» no está implementado en este CLI. Falta: " + impl["falta"], impl["salida"], False, {"verbo": verbo["nombre"]})


def ejecutar(verbo, valores, argv):
    tipo = verbo["implementacion"]["tipo"]
    if tipo == "resumen":
        return hacer_resumen(verbo)
    if tipo == "listar":
        return hacer_listar(verbo, valores)
    if tipo == "leer":
        return hacer_leer(verbo, valores)
    if tipo == "buscar":
        return hacer_buscar(verbo, valores)
    if tipo == "anexar":
        return hacer_anexar(verbo, valores, argv)
    if tipo == "http":
        return hacer_http(verbo, valores, argv)
    return sin_implementar(verbo)


def ayuda_de_verbo(verbo):
    def marca(e):
        return "<" + e["nombre"] + ">" if e["como"] == "posicional" else e["bandera"]

    def con_valor(e):
        return marca(e) + ("" if e["como"] == "posicional" or e["tipo"] == "booleano" else "=…")

    return {
        "esquema": 1, "verbo": verbo["nombre"], "tipo": verbo["tipo"], "descripcion": verbo["descripcion"],
        "uso": " ".join([PROGRAMA, verbo["nombre"]] + [con_valor(e) for e in verbo["entradas"]]),
        "entradas": [{"entrada": marca(e), "requerida": e["requerida"], "descripcion": e["descripcion"]} for e in verbo["entradas"]],
        "implementado": verbo["implementacion"]["tipo"] != "sin-implementar",
        "salida": "Llama a «" + PROGRAMA + " " + verbo["nombre"] + "» con esas entradas.",
    }


def ayuda():
    def entrada(e):
        base = "<" + e["nombre"] + ">" if e["como"] == "posicional" else e["bandera"] + ("" if e["tipo"] == "booleano" else "=…")
        return base + (" (requerida)" if e["requerida"] else "")

    cuerpo = {
        "esquema": 1, "nombre": DATOS["nombre"], "contrato": DATOS["contrato"],
        "uso": PROGRAMA + " <verbo> [posicionales] [--bandera=valor] [--booleano]",
        "verbos": [{"nombre": v["nombre"], "tipo": v["tipo"], "descripcion": v["descripcion"], "entradas": [entrada(e) for e in v["entradas"]],
                    "implementado": v["implementacion"]["tipo"] != "sin-implementar"} for v in DATOS["verbos"]],
        "vedadas": [v["nombre"] for v in DATOS["vedadas"]],
        "codigos": DATOS["codigos"],
        "detalle": PROGRAMA + " <verbo> --help: sus entradas con su descripción (valor por defecto, topes, valores).",
        "salida": salida_de_la_ayuda(),
    }
    if DATOS["http"]:
        cuerpo["base_url"] = {"variable": DATOS["http"]["base_url"]["variable"], "por_defecto": DATOS["http"]["base_url"]["por_defecto"]}
    return cuerpo


def salida_de_la_ayuda():
    if not DATOS["relectura"]:
        return "Elige un verbo."
    if any(v["nombre"] == DATOS["relectura"] and v["implementacion"]["tipo"] == "http" for v in DATOS["verbos"]):
        return "Empieza por «" + PROGRAMA + " " + DATOS["relectura"] + "»; el servidor tiene que estar levantado en " + DATOS["http"]["base_url"]["variable"] + "."
    return "Empieza por «" + PROGRAMA + " " + DATOS["relectura"] + "»: trae la huella que piden las escrituras."


def principal(argv):
    if not argv:
        raise Fallo(2, "Falta el verbo.", "Mira los verbos con «" + PROGRAMA + " --help».")
    nombre, resto = argv[0], argv[1:]
    if nombre in ("--help", "-h"):
        return ayuda()
    if nombre == "--version":
        return {"esquema": 1, "nombre": DATOS["nombre"], "contrato": DATOS["contrato"]}
    verbo = next((v for v in DATOS["verbos"] if v["nombre"] == nombre), None)
    if verbo is None:
        vedada = next((v for v in DATOS["vedadas"] if v["nombre"] == nombre), None)
        if vedada is not None:
            raise Fallo(5, "«" + nombre + "» no es un verbo: es una transición vedada al agente. " + vedada["que"] + " " + vedada["motivo"], "No la reintentes: es de una persona; pídesela.")
        raise uso("No hay ningún verbo «" + nombre + "». Los verbos son: " + ", ".join(v["nombre"] for v in DATOS["verbos"]) + ".")
    if "--help" in resto or "-h" in resto:
        return ayuda_de_verbo(verbo)
    return ejecutar(verbo, parsear(verbo, resto), resto)


def responder(codigo, cuerpo):
    sys.stdout.write(a_json(cuerpo) + "\n")
    sys.stdout.flush()
    return codigo


def main():
    try:
        return responder(0, principal(sys.argv[1:]))
    except Fallo as e:
        cuerpo = {"esquema": 1, "error": e.error, "salida": e.salida, "reintentable": e.reintentable}
        cuerpo.update(e.datos)
        return responder(e.codigo, cuerpo)
    except Exception as e:  # noqa: BLE001 — todo fallo sale como JSON con su salida
        return responder(3, {"esquema": 1, "error": "Falló inesperadamente: " + str(e), "salida": "Si se repite igual, avisa a una persona con este mensaje.", "reintentable": False})


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
`;
