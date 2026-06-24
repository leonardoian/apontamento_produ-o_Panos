import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "superpro_secret_2026";

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.status(200).end();
    return true;
  }
  return false;
}

export function getAuth(req) {
  const h = req.headers?.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); } catch { return null; }
}

export function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export function getSQL() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada");
  return neon(process.env.DATABASE_URL);
}

export async function initDB(sql) {
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    login VARCHAR(50) UNIQUE NOT NULL,
    senha_hash VARCHAR(100) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    perfil VARCHAR(20) DEFAULT 'operador',
    ativo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS referencias (
    id SERIAL PRIMARY KEY,
    cod VARCHAR(30) UNIQUE NOT NULL,
    descricao VARCHAR(200) NOT NULL,
    ativo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS programa (
    id SERIAL PRIMARY KEY,
    mes_ano VARCHAR(7) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    meta_turno INT DEFAULT 0,
    num_turnos INT DEFAULT 2,
    ativo BOOLEAN DEFAULT true,
    UNIQUE(mes_ano, ref_cod)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS lancamentos (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    turno VARCHAR(5) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    descricao VARCHAR(200),
    operador VARCHAR(100),
    realizado INT DEFAULT 0,
    meta INT DEFAULT 0,
    refugo INT DEFAULT 0,
    eficiencia NUMERIC(6,4),
    hora_inicio VARCHAR(5),
    hora_fim VARCHAR(5),
    obs TEXT,
    usuario_login VARCHAR(50),
    criado_em TIMESTAMP DEFAULT NOW()
  )`;
  const existe = await sql`SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1`;
  if (!existe.length) {
    const hash = await bcrypt.hash("admin123", 10);
    await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil)
      VALUES ('admin', ${hash}, 'Administrador', 'admin')`;
  }
}

export { bcrypt, jwt, JWT_SECRET };
