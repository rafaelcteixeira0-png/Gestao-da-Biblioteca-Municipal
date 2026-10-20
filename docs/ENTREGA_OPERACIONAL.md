# Entrega operacional — atualização de 20/10/2026

Esta entrega acrescenta atendimento com gravação em SQLite à aplicação existente. O código está salvo no GitHub. A segunda execução remota aprovou instalação, lint, tipos, build, 90 testes do servidor e 34 testes de navegador. A formatação final é conferida pelo CI. Use somente dados fictícios; homologação institucional e uso real permanecem pendentes.

## Origem e situação do trabalho

O repositório público foi recuperado a partir do commit `2f39c4054ea49173839b65ef34a2ab1845c13678`. Os 34 arquivos originais, incluindo imagens, foram verificados pelos identificadores Git; a árvore original é `44b6b536c8dc20204f4cf2a671c3655be15d7b96`. O trabalho atual está na branch `codex/reconstrucao-operacional`, enviada após autorização.

As entregas operacionais e os commits locais mencionados anteriormente na conversa não estavam presentes neste ambiente. A implementação aqui documentada foi reconstruída sobre o código público recuperado. Os documentos originais do repositório foram preservados e descrevem a etapa anterior de demonstração; este documento registra o incremento operacional atual.

Os anexos `Auditoria_Biblioteca_Cianorte.pdf`, `Auditoria_Biblioteca_Cianorte.md`, `Planejamento_Biblioteca_Cianorte.xlsx` e `Backlog_Codex_Biblioteca.md` não estão disponíveis neste ambiente. O mapeamento para os identificadores reais das tarefas do backlog está pendente de recuperação desses documentos. Nenhum identificador foi presumido.

O usuário autorizou o envio da branch ao GitHub. O repositório foi renomeado para `rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal`, mantendo o ID `1417588503`. Não houve migração de dados reais, exclusão institucional, contratação de serviços, merge ou publicação em produção.

## Comportamento implementado

| Área          | Comportamento atual                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistência  | Banco SQLite em arquivo local, chaves estrangeiras, identificadores UUID, versões de registros e transações de escrita.                                                                                             |
| Acesso        | Login por conta individual; sessões com expiração, cookie `HttpOnly` e `SameSite=Strict`; verificação de origem e CSRF nas operações de alteração. As permissões são verificadas no servidor.                       |
| Administração | Criação e edição de contas, troca da própria senha, redefinição administrativa e revogação de sessões. Há recuperação técnica pelo terminal com acesso ao arquivo local do banco.                                   |
| Leitores      | Cadastro e edição de nome e situação, busca, filtro e paginação. Este incremento não coleta CPF, endereço, telefone ou outros contatos.                                                                             |
| Obras         | Cadastro e edição de título, autor, categoria, edição e volume, com busca e paginação.                                                                                                                              |
| Exemplares    | Cadastro e edição de unidades vinculadas à obra, com UUID próprio, localização, conservação e estado. Tombo oficial é opcional; UUID e códigos demonstrativos não se tornam tombos.                                 |
| Circulação    | Um empréstimo pode reunir vários exemplares. Uma transação e um índice único parcial impedem dois empréstimos ativos do mesmo exemplar. Há devolução parcial e renovação individual com novo prazo e motivo.        |
| Histórico     | Eventos de cadastro, edição e circulação preservam valores anteriores e posteriores, responsável e metadados. O banco impede atualização e exclusão dos eventos. Eventos de segurança ficam em uma trilha própria.  |
| Concorrência  | Edições exigem a versão atual do registro. Versão desatualizada gera conflito, sem substituir a alteração anterior. Comandos de circulação usam identificadores de solicitação para permitir repetição idempotente. |
| Recuperação   | Backup consistente criptografado, verificação de integridade e restauração em novo arquivo. A restauração revoga as sessões contidas na cópia.                                                                      |

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

## Validação executada

A [primeira execução](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/actions/runs/39265878427) aprovou instalação, lint, tipos, build e 89 testes do servidor. Passaram 32 de 34 testes de navegador. As duas falhas identificaram a mesma alteração de grafia: NFKC convertia `2ª edição` em `2a edição`. A correção usa NFC nos campos descritivos e mantém NFKC para identificação de tombos, com teste de regressão.

A [segunda execução](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/actions/runs/39273011180), no commit `2bea619a38c970007cc63b025043d24412b11999`, aprovou:

| Verificação                       | Resultado                             |
| --------------------------------- | ------------------------------------- |
| Instalação, lint, tipos e build   | Aprovados                             |
| Servidor                          | 90 aprovados, 0 falhas                |
| Chromium desktop e emulação móvel | 34 aprovados, 0 falhas, 26,7 segundos |

Essa execução reprovou somente a formatação de dois arquivos. O CI gera as correções exatas do Prettier e exige aprovação de todas as etapas. A conferência final está nas [execuções atuais desta branch](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/actions?query=branch%3Acodex%2Freconstrucao-operacional).

Os testes nativos incluem 32 casos SQLite, 18 de autenticação, 7 de API, 24 de backup, 4 de CLI e 5 de configuração. Verificam disputa entre conexões, rollback, indisponibilidade, dados inválidos, versões concorrentes, histórico, permissões e recuperação.

Os 12 cenários originais e os 5 novos, em dois projetos Chromium, totalizam 34 testes de navegador. A segunda rodada aprovou cadastro, edição, empréstimo de dois exemplares, devolução parcial, renovação, recarga, histórico, acesso permitido e negado, teclado, axe e larguras de 320, 390 e 1440 pixels, usando API real e banco temporário fictício. A configuração utiliza `pt-BR` e `America/Sao_Paulo`.

Foram inspecionadas capturas de leitores, circulação e histórico em desktop e largura móvel. A revisão amostral confirmou leitura e organização nessas imagens. Os artefatos Playwright da execução têm retenção de sete dias e podem ser reproduzidos pelos testes. Emulação móvel e capturas não substituem testes em aparelho físico ou homologação com a equipe.

[VALIDACAO_TECNICA.json](VALIDACAO_TECNICA.json) registra as evidências atuais; [TESTES_SERVIDOR.txt](TESTES_SERVIDOR.txt) contém a saída dos 90 testes. O resultado local de 89 testes de 18/10 foi preservado separadamente em [VALIDACAO_LOCAL_2026-10-18.json](VALIDACAO_LOCAL_2026-10-18.json). A contagem anterior de 59 testes não foi reutilizada.

O ambiente local reiniciou durante o fechamento e permaneceu indisponível. O código e as evidências já estavam preservados no GitHub; a conclusão prossegue pelo CI existente. Os resultados remotos não significam que as restrições locais de rede e portas tenham sido removidas.

Para reproduzir com Node.js 24 e dependências disponíveis:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:server
npm run build
npx playwright install chromium
npm test
```

O Playwright inicia `tests/start-server.mjs` em `127.0.0.1:4173` com banco temporário próprio. Contas fixas existem somente nessa fixture; o servidor normal não cria senhas padrão. `bash scripts/validate-local.sh` instala dependências, aplica Prettier e executa as verificações; revise o diff.

## Pendências institucionais

1. Homologar o atendimento com a equipe e conferir os aparelhos e navegadores usados na biblioteca.
2. Recuperar os anexos e mapear os IDs reais do backlog, sem presumir identificadores.
3. Aprovar regras de circulação, tombos, acesso, retenção e recuperação.
4. Aprovar hospedagem com processo Node.js e disco persistente. A publicação Vercel existente continua demonstrativa.
5. Preparar migração real somente com aprovação específica, validação, relatório, simulação e preservação da origem. Não eliminar títulos repetidos ou transformar IDs provisórios em tombos.

Não houve merge ou publicação em produção.
