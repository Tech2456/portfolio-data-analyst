"""Connexion MariaDB/MySQL — paramètres lus dans l'environnement.

Valeurs par défaut adaptées à un poste de développement XAMPP
(root sans mot de passe sur localhost:3306). En production, définir
FIBRENET_DB_HOST / _PORT / _USER / _PASSWORD.
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pymysql

DATABASE = "fibrenet_bi"


@contextmanager
def connect(database: str | None = DATABASE) -> Iterator[pymysql.connections.Connection]:
    conn = pymysql.connect(
        host=os.getenv("FIBRENET_DB_HOST", "127.0.0.1"),
        port=int(os.getenv("FIBRENET_DB_PORT", "3306")),
        user=os.getenv("FIBRENET_DB_USER", "root"),
        password=os.getenv("FIBRENET_DB_PASSWORD", ""),
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    try:
        yield conn
    finally:
        conn.close()


def split_statements(sql: str) -> list[str]:
    """Découpe un script SQL en instructions (commentaires `--` retirés)."""
    without_comments = re.sub(r"--[^\n]*", "", sql)
    return [stmt.strip() for stmt in without_comments.split(";") if stmt.strip()]


def run_script(conn, path: Path) -> list[dict]:
    """Exécute un fichier SQL et renvoie le résultat de la dernière instruction."""
    rows: list[dict] = []
    with conn.cursor() as cur:
        for statement in split_statements(path.read_text(encoding="utf-8")):
            cur.execute(statement)
            rows = list(cur.fetchall())
    conn.commit()
    return rows
