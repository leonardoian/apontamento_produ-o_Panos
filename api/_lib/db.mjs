import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurada");
const JWT_SECRET = process.env.JWT_SECRET;

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
    meta_hora INT DEFAULT NULL,
    celula VARCHAR(30) DEFAULT 'Panos',
    ativo BOOLEAN DEFAULT true
  )`;
  await sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS celula VARCHAR(30) DEFAULT 'Panos'`;
  await sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS peso_unitario DECIMAL(8,3) DEFAULT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS programa (
    id SERIAL PRIMARY KEY,
    mes_ano VARCHAR(7) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    celula VARCHAR(30) DEFAULT 'Panos',
    meta_turno INT DEFAULT 0,
    num_turnos INT DEFAULT 2,
    ativo BOOLEAN DEFAULT true,
    UNIQUE(mes_ano, ref_cod, celula)
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
  await sql`CREATE TABLE IF NOT EXISTS ordens_producao (
    id SERIAL PRIMARY KEY,
    celula VARCHAR(30) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    quantidade INT NOT NULL,
    meta_hora INT NOT NULL,
    horas_por_turno DECIMAL(4,1) NOT NULL DEFAULT 8,
    data_prevista DATE,
    obs TEXT,
    criado_por VARCHAR(50),
    criado_em TIMESTAMP DEFAULT NOW(),
    ativo BOOLEAN DEFAULT true
  )`;
  // Normaliza valores de célula com acento ou caixa errada que possam ter sido importados
  await sql`UPDATE referencias SET celula = 'Importacao' WHERE celula IN ('Importação','importação','IMPORTACAO','IMPORTAÇÃO','importacao')`;
  await sql`UPDATE referencias SET celula = 'Aluminio'   WHERE celula IN ('Alumínio','ALUMINIO','ALUMÍNIO','aluminio','alumínio')`;
  await sql`UPDATE referencias SET celula = 'Panos'      WHERE celula IN ('PANOS','panos')`;
  await sql`UPDATE referencias SET celula = 'Rodos'      WHERE celula IN ('RODOS','rodos')`;
  await sql`UPDATE referencias SET celula = 'Manual'     WHERE celula IN ('MANUAL','manual')`;
  await sql`UPDATE referencias SET celula = 'Placas'     WHERE celula IN ('PLACAS','placas')`;
  await sql`UPDATE referencias SET celula = 'Bettanin'   WHERE celula IN ('BETTANIN','bettanin')`;
  await sql`UPDATE referencias SET celula = 'Sanremo'    WHERE celula IN ('SANREMO','sanremo')`;
  await sql`UPDATE referencias SET celula = 'RevendaIndustrial'  WHERE LOWER(REPLACE(celula,' ','')) = 'revendaindustrial'`;
  await sql`UPDATE referencias SET celula = 'BettaninIndustrial' WHERE LOWER(REPLACE(celula,' ','')) = 'bettaninindustrial'`;

  await sql`UPDATE programa SET celula = 'Importacao'        WHERE LOWER(REPLACE(celula,' ','')) = 'importacao'`;
  await sql`UPDATE programa SET celula = 'Aluminio'          WHERE LOWER(REPLACE(celula,' ','')) IN ('aluminio','alumínio')`;
  await sql`UPDATE programa SET celula = 'Panos'             WHERE LOWER(celula) = 'panos'`;
  await sql`UPDATE programa SET celula = 'Rodos'             WHERE LOWER(celula) = 'rodos'`;
  await sql`UPDATE programa SET celula = 'Manual'            WHERE LOWER(celula) = 'manual'`;
  await sql`UPDATE programa SET celula = 'Placas'            WHERE LOWER(celula) = 'placas'`;
  await sql`UPDATE programa SET celula = 'Bettanin'          WHERE LOWER(celula) = 'bettanin'`;
  await sql`UPDATE programa SET celula = 'Sanremo'           WHERE LOWER(celula) = 'sanremo'`;
  await sql`UPDATE programa SET celula = 'RevendaIndustrial'  WHERE LOWER(REPLACE(celula,' ','')) = 'revendaindustrial'`;
  await sql`UPDATE programa SET celula = 'BettaninIndustrial' WHERE LOWER(REPLACE(celula,' ','')) = 'bettaninindustrial'`;
  await sql`UPDATE referencias SET celula = 'ImportacaoManual'  WHERE LOWER(REPLACE(celula,' ','')) IN ('importacaomanual','importaçãotrabalho','importacaotrabalho')`;
  await sql`UPDATE programa    SET celula = 'ImportacaoManual'  WHERE LOWER(REPLACE(celula,' ','')) IN ('importacaomanual','importaçãotrabalho','importacaotrabalho')`;

  await sql`CREATE TABLE IF NOT EXISTS estoque (
    id SERIAL PRIMARY KEY,
    ref_cod VARCHAR(30) NOT NULL,
    cd VARCHAR(20) NOT NULL,
    deposito VARCHAR(10) NOT NULL,
    quantidade INT DEFAULT 0,
    atualizado_em TIMESTAMP DEFAULT NOW(),
    UNIQUE(ref_cod, cd, deposito)
  )`;
  await sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_mensal INT DEFAULT NULL`;

  const existe = await sql`SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1`;
  if (!existe.length) {
    const hash = await bcrypt.hash("admin123", 10);
    await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil)
      VALUES ('admin', ${hash}, 'Administrador', 'admin')`;
  }
}

export { bcrypt, jwt, JWT_SECRET };
