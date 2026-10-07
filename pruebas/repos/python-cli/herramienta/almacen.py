import json
import os
import tempfile


def leer():
    with open("estado.json") as f:
        return json.load(f)


def guardar(ensayo):
    if ensayo:
        return
    with open("estado.json.tmp", "w") as f:
        f.write("{}")
    os.replace("estado.json.tmp", "estado.json")
