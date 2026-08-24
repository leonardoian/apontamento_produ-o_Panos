import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurada");
const JWT_SECRET = process.env.JWT_SECRET;

// Cache para evitar re-executar initDB em cada request dentro da mesma instância
let _dbReady = false;

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
  if (_dbReady) return;

  // Fase 1: criar todas as tabelas em paralelo
  await Promise.all([
    sql`CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      login VARCHAR(50) UNIQUE NOT NULL,
      senha_hash VARCHAR(100) NOT NULL,
      nome VARCHAR(100) NOT NULL,
      perfil VARCHAR(20) DEFAULT 'operador',
      ativo BOOLEAN DEFAULT true
    )`,
    sql`CREATE TABLE IF NOT EXISTS referencias (
      id SERIAL PRIMARY KEY,
      cod VARCHAR(30) UNIQUE NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      meta_hora INT DEFAULT NULL,
      celula VARCHAR(30) DEFAULT 'Panos',
      ativo BOOLEAN DEFAULT true
    )`,
    sql`CREATE TABLE IF NOT EXISTS programa (
      id SERIAL PRIMARY KEY,
      mes_ano VARCHAR(7) NOT NULL,
      ref_cod VARCHAR(30) NOT NULL,
      celula VARCHAR(30) DEFAULT 'Panos',
      meta_turno INT DEFAULT 0,
      num_turnos INT DEFAULT 2,
      ativo BOOLEAN DEFAULT true,
      UNIQUE(mes_ano, ref_cod, celula)
    )`,
    sql`CREATE TABLE IF NOT EXISTS lancamentos (
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
    )`,
    sql`CREATE TABLE IF NOT EXISTS ordens_producao (
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
    )`,
    sql`CREATE TABLE IF NOT EXISTS estoque (
      id SERIAL PRIMARY KEY,
      ref_cod VARCHAR(30) NOT NULL,
      cd VARCHAR(20) NOT NULL,
      deposito VARCHAR(10) NOT NULL,
      quantidade INT DEFAULT 0,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(ref_cod, cd, deposito)
    )`,
    // `estoque` guarda só a foto atual: cada importação sobregrava a anterior.
    // Este histórico registra um snapshot por importação, permitindo ver a
    // evolução do saldo e quando uma referência entrou em ruptura.
    // importado_em = o marcador da importação, igual para todas as linhas dela.
    sql`CREATE TABLE IF NOT EXISTS estoque_historico (
      id SERIAL PRIMARY KEY,
      importado_em TIMESTAMP NOT NULL,
      ref_cod VARCHAR(30) NOT NULL,
      mtz_0860 INT DEFAULT 0,
      mtz_0803 INT DEFAULT 0,
      mtz_0802 INT DEFAULT 0,
      sp_0803 INT DEFAULT 0,
      pe_0803 INT DEFAULT 0,
      total INT DEFAULT 0,
      forecast_mensal INT,
      UNIQUE(importado_em, ref_cod)
    )`,
  ]);

  // Fase 2: ALTER TABLE em paralelo (depende das tabelas existirem)
  await Promise.all([
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS celula VARCHAR(30) DEFAULT 'Panos'`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS peso_unitario DECIMAL(8,3) DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS estoque_atual INT DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_mensal INT DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_mi_pe  INT DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_mi_sp  INT DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_mi_mtz INT DEFAULT NULL`,
    sql`ALTER TABLE referencias ADD COLUMN IF NOT EXISTS forecast_me     INT DEFAULT NULL`,
    // Série de uma referência ao longo do tempo (tela de evolução).
    sql`CREATE INDEX IF NOT EXISTS ix_est_hist_ref ON estoque_historico (ref_cod, importado_em DESC)`,
    // Lista de importações e leitura de um snapshot inteiro.
    sql`CREATE INDEX IF NOT EXISTS ix_est_hist_data ON estoque_historico (importado_em DESC)`,
  ]);

  // Fase 3: normalização de dados legados em paralelo
  await Promise.all([
    sql`UPDATE referencias SET celula = 'Importacao' WHERE celula IN ('Importação','importação','IMPORTACAO','IMPORTAÇÃO','importacao')`,
    sql`UPDATE referencias SET celula = 'Aluminio'   WHERE celula IN ('Alumínio','ALUMINIO','ALUMÍNIO','aluminio','alumínio')`,
    sql`UPDATE referencias SET celula = 'Panos'      WHERE celula IN ('PANOS','panos')`,
    sql`UPDATE referencias SET celula = 'Rodos'      WHERE celula IN ('RODOS','rodos')`,
    sql`UPDATE referencias SET celula = 'Manual'     WHERE celula IN ('MANUAL','manual')`,
    sql`UPDATE referencias SET celula = 'Placas'     WHERE celula IN ('PLACAS','placas')`,
    sql`UPDATE referencias SET celula = 'Bettanin'   WHERE celula IN ('BETTANIN','bettanin')`,
    sql`UPDATE referencias SET celula = 'Sanremo'    WHERE celula IN ('SANREMO','sanremo')`,
    sql`UPDATE referencias SET celula = 'RevendaIndustrial'  WHERE LOWER(REPLACE(celula,' ','')) = 'revendaindustrial'`,
    sql`UPDATE referencias SET celula = 'BettaninIndustrial' WHERE LOWER(REPLACE(celula,' ','')) = 'bettaninindustrial'`,
    sql`UPDATE referencias SET celula = 'ImportacaoManual'   WHERE LOWER(REPLACE(celula,' ','')) IN ('importacaomanual','importaçãotrabalho','importacaotrabalho')`,
    sql`UPDATE programa SET celula = 'Importacao'        WHERE LOWER(REPLACE(celula,' ','')) = 'importacao'`,
    sql`UPDATE programa SET celula = 'Aluminio'          WHERE LOWER(REPLACE(celula,' ','')) IN ('aluminio','alumínio')`,
    sql`UPDATE programa SET celula = 'Panos'             WHERE LOWER(celula) = 'panos'`,
    sql`UPDATE programa SET celula = 'Rodos'             WHERE LOWER(celula) = 'rodos'`,
    sql`UPDATE programa SET celula = 'Manual'            WHERE LOWER(celula) = 'manual'`,
    sql`UPDATE programa SET celula = 'Placas'            WHERE LOWER(celula) = 'placas'`,
    sql`UPDATE programa SET celula = 'Bettanin'          WHERE LOWER(celula) = 'bettanin'`,
    sql`UPDATE programa SET celula = 'Sanremo'           WHERE LOWER(celula) = 'sanremo'`,
    sql`UPDATE programa SET celula = 'RevendaIndustrial'  WHERE LOWER(REPLACE(celula,' ','')) = 'revendaindustrial'`,
    sql`UPDATE programa SET celula = 'BettaninIndustrial' WHERE LOWER(REPLACE(celula,' ','')) = 'bettaninindustrial'`,
    sql`UPDATE programa    SET celula = 'ImportacaoManual'  WHERE LOWER(REPLACE(celula,' ','')) IN ('importacaomanual','importaçãotrabalho','importacaotrabalho')`,
  ]);

  // Fase 4: usuário admin padrão
  const existe = await sql`SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1`;
  if (!existe.length) {
    const hash = await bcrypt.hash("admin123", 10);
    await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil)
      VALUES ('admin', ${hash}, 'Administrador', 'admin')`;
  }
  _dbReady = true;
}

export { bcrypt, jwt, JWT_SECRET };
