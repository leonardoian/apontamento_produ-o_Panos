# Sistema de Produção — Superpro
## Funcionalidades

### 1. **Meta Hora em Referências**
Define a meta de peças por hora para cada referência:
- Campo `meta_hora` (número inteiro, ex: 80 pçs/h)
- Editável diretamente na tabela de referências (clique no ícone ✎)
- Utilizado para cálculo preciso de eficiência

### 2. **Cálculo de Eficiência Baseado em Horas**
A eficiência é calculada por horas trabalhadas, não por turno completo:
- **Fórmula:** Eficiência = (Realizado ÷ (Meta Hora × Horas)) × 100
- **Exemplo:** Se meta é 80 pçs/h, trabalhando 1h e realizando 80 pçs = 100% de eficiência
- **Requer preenchimento:** Hora Início e Hora Fim do apontamento
- **Fallback:** Se não preenchidas as horas, usa meta do turno

### 3. **Sistema de Múltiplas Células de Trabalho**
Suporte para 5 células/setores diferentes:
- **Celular de Alumínio**
- **Máquina de Panos** (padrão)
- **Máquina de Placas**
- **Máquina de Rodos**
- **Trabalho Manual**

Cada célula possui:
- Programa mensal próprio
- Referências específicas com metas diferentes
- Lançamentos filtrados por célula

#### Como usar:
- **Aba Programa:** Selecione a célula antes de visualizar/adicionar referências
- **Aba Lançamento:** Selecione a célula → carrega referências daquela célula
- **Aba Histórico:** Filtre por célula para ver apenas lançamentos daquele setor

### 4. **Importação de Excel com Suporte a Células**
Importe programas de múltiplas células de uma planilha:
- Acesse `/importar.html`
- Planilha deve conter abas: `REFERENCIAS` e `PROGRAMA`
- Coluna `CELULA` especifica a célula (padrão: Panos)

**Estrutura esperada:**

| MÊS/ANO | CELULA | COD_REF | Meta por Turno | Nº de Turnos |
|---------|--------|---------|---|---|
| 2026-06 | Panos | SP2745LR | 80 | 2 |
| 2026-06 | Aluminio | SP2824AZ | 100 | 2 |

---

## Banco de Dados

### Tabelas principais:

**`referencias`**
- `id` — ID único
- `cod` — Código (ex: SP2745LR)
- `descricao` — Descrição do produto
- `meta_hora` — Meta de peças/hora (INT, nullable)
- `ativo` — Ativo/Inativo (boolean)

**`programa`**
- `id` — ID único
- `mes_ano` — Mês (YYYY-MM)
- `ref_cod` — Referência
- **`celula`** — Célula/Setor (VARCHAR, default: 'Panos')
- `meta_turno` — Meta por turno
- `num_turnos` — Número de turnos
- `ativo` — Ativo/Inativo
- **UNIQUE(mes_ano, ref_cod, celula)** — Mesma ref em células diferentes

**`lancamentos`**
- `id` — ID único
- `data` — Data do apontamento
- `turno` — T1 ou T2
- `ref_cod` — Referência
- `operador` — Nome do operador
- `realizado` — Peças realizadas
- `meta` — Meta de peças
- `refugo` — Peças refugadas
- `eficiencia` — Eficiência calculada (0.0 a 1.0)
- `hora_inicio` — Hora de início
- `hora_fim` — Hora de término
- `obs` — Observações
- `usuario_login` — Login de quem lançou
- `criado_em` — Timestamp

---

## APIs

### GET `/api/referencias`
Retorna todas as referências ativas.
```json
[
  { "cod": "SP2745LR", "descricao": "ROLO TECIDO...", "meta_hora": 80 }
]
```

### POST `/api/referencias`
Cria/atualiza referência.
```json
{ "cod": "SP2745LR", "descricao": "...", "meta_hora": 80 }
```

### GET `/api/programa?mes=2026-06&celula=Panos`
Retorna programa de uma célula para um mês.
```json
[
  { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos", "meta_turno": 80, "num_turnos": 2, "meta_total": 160, "descricao": "...", "meta_hora": 80 }
]
```

### POST `/api/programa`
Cria/atualiza programa.
```json
{ "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos", "meta_turno": 80, "num_turnos": 2 }
```

### GET `/api/lancamentos?mes=2026-06&celula=Panos&turno=T1&ref=SP2745LR`
Retorna lançamentos (com filtros opcionais).

### POST `/api/lancamentos`
Cria lançamento.
```json
{
  "data": "2026-06-24",
  "turno": "T1",
  "ref_cod": "SP2745LR",
  "operador": "João",
  "realizado": 80,
  "meta": 80,
  "refugo": 0,
  "hora_inicio": "08:00",
  "hora_fim": "09:00",
  "obs": "Sem paradas",
  "eficiencia": 1.0
}
```

---

## Deploy no Netlify

### 1. Suba o projeto para o GitHub
- Crie um repositório no GitHub
- Faça upload de todos os arquivos desta pasta

### 2. Conecte ao Netlify
- Acesse app.netlify.com
- "Add new site" → "Import an existing project"
- Conecte ao repositório do GitHub

### 3. Configure as variáveis de ambiente
No Netlify: Site configuration → Environment variables → Add variable:

```
DATABASE_URL = postgresql://neondb_owner:npg_UwfyJtDlWK94@ep-empty-tree-acnvvjsm-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET   = superpro_producao_2026_secret
```

### 4. Deploy
- Build command: `npm install`
- Publish directory: `public`
- Clique em Deploy

### 5. Acesse o sistema
- URL gerada pelo Netlify (ex: https://superpro-producao.netlify.app)
- Login padrão: admin / admin123

## Estrutura
```
/
├── netlify.toml              # Config do Netlify
├── package.json              # Dependências
├── netlify/functions/
│   └── api.mjs               # API serverless (Neon + JWT)
└── public/
    ├── index.html            # Frontend completo
    └── _redirects            # Rotas Netlify
```
