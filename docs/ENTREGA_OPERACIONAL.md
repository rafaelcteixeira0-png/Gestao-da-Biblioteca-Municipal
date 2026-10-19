# Entrega operacional local — reconstrução de 18/10/2026

Esta entrega acrescenta atendimento com gravação em SQLite à aplicação existente. O ambiente é exclusivamente local e utiliza dados fictícios. A validação da interface continua pendente enquanto as dependências de desenvolvimento e o navegador não estiverem disponíveis.

## Origem e situação do trabalho

O repositório público foi recuperado a partir do commit `2f39c4054ea49173839b65ef34a2ab1845c13678`. Os 34 arquivos originais, incluindo imagens, foram verificados pelos identificadores Git; a árvore original é `44b6b536c8dc20204f4cf2a671c3655be15d7b96`. O trabalho atual está na branch local `codex/reconstrucao-operacional`.

As entregas operacionais e os commits locais mencionados anteriormente na conversa não estavam presentes neste ambiente. A implementação aqui documentada foi reconstruída sobre o código público recuperado. Os documentos originais do repositório foram preservados e descrevem a etapa anterior de demonstração; este documento registra o incremento operacional atual.

Os anexos de auditoria, planejamento e backlog não estão disponíveis neste ambiente. O mapeamento para os identificadores reais das tarefas do backlog está pendente de recuperação desses documentos. Nenhum identificador foi presumido.

Não houve importação ou migração de dados reais, exclusão de registros institucionais, contratação de serviços, push, merge ou publicação em produção.

## Comportamento implementado

| Área | Comportamento atual |
| --- | --- |
| Persistência | Banco SQLite em arquivo local, chaves estrangeiras, identificadores UUID, versões de registros e transações de escrita. |
| Acesso | Login por conta individual; sessões com expiração, cookie `HttpOnly` e `SameSite=Strict`; verificação de origem e CSRF nas operações de alteração. As permissões são verificadas no servidor. |
| Administração | Criação e edição de contas, troca da própria senha, redefinição administrativa e revogação de sessões. Há recuperação técnica pelo terminal com acesso ao arquivo local do banco. |
| Leitores | Cadastro e edição de nome e situação, busca, filtro e paginação. Este incremento não coleta CPF, endereço, telefone ou outros contatos. |
| Obras | Cadastro e edição de título, autor, categoria, edição e volume, com busca e paginação. |
| Exemplares | Cadastro e edição de unidades vinculadas à obra, com UUID próprio, localização, conservação e estado. Tombo oficial é opcional; UUID e códigos demonstrativos não se tornam tombos. |
| Circulação | Um empréstimo pode reunir vários exemplares. Uma transação e um índice único parcial impedem dois empréstimos ativos do mesmo exemplar. Há devolução parcial e renovação individual com novo prazo e motivo. |
| Histórico | Eventos de cadastro, edição e circulação preservam valores anteriores e posteriores, responsável e metadados. O banco impede atualização e exclusão dos eventos. Eventos de segurança ficam em uma trilha própria. |
| Concorrência | Edições exigem a versão atual do registro. Versão desatualizada gera conflito, sem substituir a alteração anterior. Comandos de circulação usam identificadores de solicitação para permitir repetição idempotente. |
| Recuperação | Backup consistente criptografado, verificação de integridade e restauração em novo arquivo. A restauração revoga as sessões contidas na cópia. |

Senhas são armazenadas com scrypt e salt. Tokens de sessão são armazenados por hash. A autorização é reavaliada a partir da conta no banco; ocultar uma ação na interface não é o único controle de acesso.

Os perfis são:

- **Administrador:** opera cadastros e circulação e administra contas e sessões.
- **Atendente:** opera cadastros e circulação; não administra contas.
- **Leitor:** autentica e pode trocar a própria senha, mas não consulta nem altera os registros do atendimento. Um portal do leitor não faz parte desta entrega.

Não existe importador de planilha nesta etapa. Títulos repetidos permanecem possíveis e exemplares diferentes recebem identificadores diferentes, mesmo sem tombo. As regras de prazo e renovação são explícitas no atendimento; políticas institucionais, limites e aprovação para uso real permanecem pendentes.

## Demonstração e atendimento persistido

- `/#dashboard` e os demais módulos da demonstração continuam usando os dados fictícios originais. Busca, filtros, paginação, detalhes e exportação demonstrativa permanecem nessa área.
- `/#atendimento` utiliza a API e o SQLite local. A interface identifica os registros como **dados fictícios persistidos**. O banco começa sem leitores, obras, exemplares ou empréstimos; a inicialização cria apenas a administração solicitada no terminal.
- As áreas não compartilham registros. Criar um leitor no atendimento não altera os números da demonstração, e exportar o resumo demonstrativo não gera um backup do banco.
- O atendimento só informa sucesso quando a API confirma a operação. Falhas de gravação e conflitos são apresentados ao operador. Falha na atualização da lista após uma gravação confirmada também é informada.

## Executar localmente

Requisito: **Node.js 24 ou superior**. O servidor utiliza `node:sqlite` e os testes do servidor utilizam o executor nativo do Node. Não é necessário contratar nem provisionar um serviço de banco.

Na raiz do projeto:

```bash
npm ci
cp .env.example .env
npm run library -- init
npm run build
npm start
```

`init` solicita usuário, nome fictício e senha administrativa no terminal. A senha precisa ter entre 12 e 128 caracteres, incluindo letras e números, e não é exibida durante a digitação. Não existe senha administrativa padrão. A inicialização recusa criar outra administração inicial se o banco já tiver sido inicializado.

Com o exemplo de configuração, abra `http://localhost:3001/#atendimento`. O servidor aceita apenas `127.0.0.1` ou `::1` como endereço de escuta; o padrão é loopback IPv4. Mantenha o terminal do servidor aberto durante o atendimento.

### Configuração de exemplo

O arquivo `.env.example` contém:

```dotenv
LIBRARY_DB_PATH=.library-data/library.sqlite
LIBRARY_HOST=127.0.0.1
LIBRARY_PORT=3001
LIBRARY_ORIGIN=http://localhost:3001
LIBRARY_COOKIE_SECURE=false
```

`LIBRARY_ORIGIN` deve corresponder exatamente à origem aberta no navegador, incluindo protocolo, host e porta. `localhost` e `127.0.0.1` são origens diferentes. O valor `false` do cookie seguro permite o HTTP deste ensaio local; a preparação de uma implantação HTTPS exige configuração e revisão próprias.

O `.gitignore` exclui `.env`, bancos, backups e diretórios de dados. As permissões locais são restringidas pelo código. Isso não substitui a definição institucional de acesso à máquina e armazenamento.

Para automação, a CLI aceita `LIBRARY_ADMIN_USERNAME`, `LIBRARY_ADMIN_NAME`, `LIBRARY_ADMIN_PASSWORD` e `LIBRARY_BACKUP_PASSPHRASE`. Injete valores secretos pelo ambiente do processo; não registre senhas em comandos versionados ou em documentação. O uso interativo dispensa essas variáveis.

### Desenvolvimento com Vite

Para editar a interface com atualização automática, use no `.env`:

```dotenv
LIBRARY_ORIGIN=http://127.0.0.1:5173
```

Em um terminal:

```bash
npm run api
```

Em outro terminal:

```bash
npm run dev -- --port 5173 --strictPort
```

Abra `http://127.0.0.1:5173/#atendimento`. O Vite encaminha `/api` para `http://127.0.0.1:3001`; as chamadas do navegador continuam usando a origem da interface. Mantenha a API na porta 3001 para usar o proxy atual. Volte `LIBRARY_ORIGIN` para `http://localhost:3001` ao retornar ao modo `npm start` e reinicie o servidor após alterar a configuração.

## Backup, verificação e restauração

Os comandos abaixo trabalham no banco fictício definido por `LIBRARY_DB_PATH`. Crie o diretório e escolha nomes ainda inexistentes para cada ensaio:

```bash
mkdir -p backups
npm run library -- backup backups/ensaio-local.backup
npm run library -- verify-backup backups/ensaio-local.backup
npm run library -- restore backups/ensaio-local.backup .library-data/ensaio-restaurado.sqlite
```

A CLI solicita uma frase de proteção com pelo menos 16 caracteres. A cópia usa AES-256-GCM com chave derivada por scrypt. `verify-backup` verifica descriptografia, integridade SQLite, relacionamentos, estrutura esperada e registros. `restore` exige um destino inexistente e preserva o arquivo de origem; nenhum dos comandos substitui um arquivo de destino existente. O limite desta versão é de 256 MiB por backup.

O resultado JSON informa contagens, resumos SHA-256 por tabela, duração e verificações. O backup cobre as tabelas do banco; código, `.env`, frase de proteção e configurações externas precisam de conservação separada. Não existe agendamento automático ou serviço externo de cópias nesta entrega.

Para revisar o banco restaurado, encerre a instância que usará a mesma porta, aponte temporariamente `LIBRARY_DB_PATH` para `.library-data/ensaio-restaurado.sqlite` e execute `npm start`. Entre com uma conta administrativa existente no momento da cópia. Sessões anteriores ao restauro não permanecem válidas. Não execute `init` em um banco já restaurado.

Se for necessário recuperar a senha da administração local:

```bash
npm run library -- recover-admin
```

O comando exige uma conta administrativa ativa existente e acesso do operador ao banco no sistema operacional. Redefine a senha, revoga as sessões da conta e registra o evento de recuperação.

### Ensaio verificável realizado

O arquivo [RECUPERACAO.json](RECUPERACAO.json) registra um novo ensaio local com **um leitor, uma obra, dois exemplares e um empréstimo com devolução parcial**. Foram conferidos os registros restaurados, os relacionamentos, a integridade e o login administrativo. Um cadastro realizado após a cópia permaneceu somente na origem, demonstrando a fronteira temporal da recuperação.

Nesse ensaio pequeno e fictício, o backup levou 64 ms, a restauração 67 ms e a restauração com login 123 ms. Esses valores descrevem apenas a execução registrada neste ambiente. Não medem a rede, o equipamento ou o volume de dados da biblioteca e não estabelecem RPO ou RTO institucionais. Frequência, retenção, destino separado, responsáveis e objetivos de recuperação ainda precisam ser definidos.

## Validação nesta reconstrução

**82 testes nativos do servidor aprovados.** A suíte cobre domínio e persistência, autenticação e permissões, API, backup/restauração e CLI. Inclui sucesso, exemplar indisponível, dados inválidos, conflitos de versão, histórico preservado, acesso permitido e negado, revogação de sessões e recuperação em arquivo separado.

| Verificação | Situação deste registro |
| --- | --- |
| Testes nativos: `npm run test:server` | 82 aprovados. |
| Tipos: `npm run typecheck` | Pendente de execução com as dependências disponíveis. |
| Lint: `npm run lint` | Pendente de execução com as dependências disponíveis. |
| Formatação: `npm run format:check` | Pendente de execução com as dependências disponíveis. |
| Build: `npm run build` | Pendente de execução com as dependências disponíveis. |
| Playwright: `npm test` | Testes preparados; execução de navegador pendente. |

Os novos testes em `tests/operational.spec.ts` usam o servidor real e banco temporário fictício, sem mocks. Cobrem o fluxo administrativo de cadastro, edição, empréstimo de dois exemplares, devolução parcial, renovação, recarga e histórico; negação ao perfil leitor; atendimento autorizado com administração de contas negada; validação e concorrência; teclado, axe e larguras de 320, 390 e 1440 pixels. Estão configurados projetos desktop e mobile com Chromium. A existência dos testes não significa que esses cenários de navegador já passaram. As configurações mobile emulam um navegador e não substituem teste em aparelho físico.

Para executar as verificações quando as dependências estiverem disponíveis:

```bash
npm run test:server
npm run typecheck
npm run lint
npm run format:check
npm run build
npx playwright install chromium
npm test
```

O Playwright inicia `tests/start-server.mjs` em `127.0.0.1:4173` com banco temporário próprio. As contas e senhas fixas dessa fixture existem apenas nos testes; o início normal da aplicação não as cria. O relatório fica em `playwright-report/`, e os artefatos de falhas ficam em `test-results/`. Esses diretórios não são versionados.

## Pendências e próxima etapa

1. Concluir tipos, lint, formatação, build e navegador; corrigir eventuais falhas e atualizar este registro com resultados efetivamente executados.
2. Revisar visualmente e com atendimento assistido os formulários, seleção de exemplares, devolução parcial e renovação. A interface foi implementada em português brasileiro; a homologação visual permanece pendente.
3. Recuperar os anexos para mapear esta entrega aos identificadores reais do backlog e registrar o aceite de cada tarefa sem marcar preparação como conclusão.
4. Aprovar regras de circulação, identificação oficial dos exemplares, acesso, retenção e recuperação. Definir infraestrutura institucional antes de qualquer exposição externa; este servidor local não configura a hospedagem Vercel existente para persistir SQLite.
5. Somente após aprovação específica, preparar a migração real com validação, relatório de inconsistências, simulação e preservação da origem. Nenhuma exclusão automática de títulos repetidos ou atribuição de tombos oficiais está autorizada por esta entrega.

O núcleo local está implementado e os testes nativos registram validação do servidor. A conclusão da validação técnica e o aceite do atendimento no navegador continuam necessários antes de considerar os cinco pontos integralmente homologados.
