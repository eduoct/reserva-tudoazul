#!/usr/bin/env node
/* POST 2 montado a partir do formulário do POST 1 — v1.6.4.
 *
 *   npm test        (ou: node test/test_post2_formulario.js)
 *
 * Caso real (10/11/2026): Tauá Atibaia, tudoazul, 2 adultos + crianças de 2 e 7.
 * Três tentativas (v1.6.1, v1.6.2, v1.6.3) com HTTP 500 no POST 2, com idades e
 * comId da criança já descartados. O que sobrava: no modo results o painel
 * montava o bookingPaxes com builder próprio e um comId só com os preenchidos,
 * enquanto o site serializa O FORMULÁRIO (campo por campo, linha por linha) e
 * junta os comId de todas as linhas, vazios inclusive.
 *
 * O formulário base é o REAL (booking.aspx do www, 13/08/2026, 2 adultos); as
 * linhas de criança são cópia dele (o formulário com criança só aparece logado).
 * Os cenários marcados "hipotético" mexem nas linhas para cobrir campos que o
 * formulário logado do tudoazul PODE ter (pax-gender, que entrou no serializer
 * do site depois de agosto; expedição do documento; e-mail/nacionalidade).
 *
 * Equivalência com o serializer DO SITE: se existir o JS do site salvo na
 * workspace (AZUL_SITE_JS, default projects/azul-hoteis-monitor), o teste
 * carrega o bookingPaxes.min.js de 10/11/2026 e o getFormParams do base.min.js
 * e compara byte a byte. Sem os arquivos, esses testes são pulados.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { montar, fixture, espera, PESSOAS } = require('./harness');

const www = fixture('www_results_roomselector.json');
const vivo = fixture('tudoazul_roomselector_live.json');
const BARRA = {
  dados: JSON.parse(www.roomSelectors[0].data),                     // [{children:[{age:7},{age:4}]}]
  vivos: { adults: 2, children: +vivo.step2.childVal, ages: vivo.step2.ageVals.map(Number) }
};
const igual = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);

function pessoa(cpf, tipo) {
  const p = PESSOAS[cpf];
  return { type: tipo, doc: cpf, docKind: 'cpf', name: p.Name, surname: p.LastName,
           birthday: p.BirthDate, treatment: tipo === '0' ? 'MR' : 'MSTR', ffp: '' };
}
const PRESET = [pessoa('00000000001', '0'), pessoa('00000000002', '0'),
                pessoa('00000000003', '1'), pessoa('00000000004', '1')];   // 7 e 4

// a 4ª pessoa "não tem cadastro": o harness responde ErrorData para CPF fora de PESSOAS
async function casoEduSemCadastro(o) {
  const t = montar(Object.assign({ barras: [BARRA], post1Idades: [7, 4] }, o || {}));
  await espera(0);
  t.escolher();
  ['00000000001', '00000000002', '00000000003', '00000000009'].forEach((cpf, i) => t.digitar(i, 'doc', cpf));
  t.clicar('lookup-all');
  await espera(1500);
  // a criança de 4 sem cadastro: dados à mão (nascimento que dá 4 no check-in)
  t.digitar(3, 'name', 'Teste');
  t.digitar(3, 'surname', 'Crianca Manual');
  t.digitar(3, 'birthday', '03/03/2022');
  return t;
}

// ── serializer do site (JS real, se estiver salvo) ──
function carregarSite(t) {
  const dir = process.env.AZUL_SITE_JS || '/home/clawdbot/.openclaw/workspace/projects/azul-hoteis-monitor';
  const bp = path.join(dir, 'consultas', '2026-11-10-booking-criancas', 'js_bookingPaxes.min.js');
  const base = path.join(dir, 'spike', 'js_base.min.js');
  if (!fs.existsSync(bp) || !fs.existsSync(base)) return null;
  const w = t.w;
  // o bookingPaxes.min.js chama isto no carregamento (vem de outros scripts do site)
  w.setMask = function () {};
  w.addMask = function () {};
  w.jQuery.fn.validate = function () { return true; };
  w.jQuery.i18n = { get: (k) => k };
  w.eval(fs.readFileSync(bp, 'utf8'));
  const b = fs.readFileSync(base, 'utf8');
  const i = b.indexOf('$jbe.getFormParams=function');
  const j = b.indexOf(',$jbe.parseQueryHash=', i);
  if (i < 0 || j < 0) throw new Error('não achei o $jbe.getFormParams no base.min.js');
  w.eval(b.slice(i, j) + ';');
  return {
    paxes: ($bd) => JSON.stringify(w.$jbe.bookingPaxes.getPaxesInfo($bd.find('.booking-paxes'))),
    hidden: ($bd) => JSON.parse(JSON.stringify(w.$jbe.getFormParams($bd.find('.booking-data__hidden-fields'))))
  };
}
function bdDoPost1(t) { return t.w.jQuery(t.api.state.post1.doc).find('.booking-data').first(); }

// ── ajustes hipotéticos nas linhas do formulário ──
function addCampo(linha, html) {
  const alvo = linha.querySelector('.booking-paxes__pax-fields-row--extra-fields');
  alvo.insertAdjacentHTML('beforeend', html);
}
const GENERO = (linha, info) => {
  if (info.tipo === 0) return;
  addCampo(linha, '<label class="booking-paxes__pax-field"><span class="booking-paxes__pax-field-label js-booking-paxes__pax-field-label">' +
    'Sexo<span class="js-booking-paxes__pax-field-label--asterisk">*</span></span>' +
    '<select name="pax-gender" class="form-control" required="required"><option value="">Selecione</option>' +
    '<option value="M">Masculino</option><option value="F">Feminino</option></select></label>');
};
const EXPEDICAO = (linha) => {
  linha.querySelector('.booking-paxes__pax-fields-row').insertAdjacentHTML('beforeend',
    '<div class="js-pax-document-expedition hidden"><input type="text" name="pax-document-expedition" ' +
    'data-cpf-date="01/01/1900" required="required" value=""></div>');
};
const CONTATO = (linha, info) => {
  if (info.tipo !== 0) return;
  addCampo(linha, '<input type="text" name="pax-mail" value="">' +
    '<select name="pax-nationality"><option value="">-</option><option value="BR">Brasil</option><option value="AR">Argentina</option></select>');
};
const CRIANCA_SEM_DOC = (linha, info) => {
  if (info.tipo === 0 || info.idade !== 4) return;
  const bloco = linha.querySelector('[name=pax-idTDC]').closest('.booking-paxes__pax-field--validation');
  bloco.remove();
};
const juntar = (...fs) => (l, i) => fs.forEach((f) => f(l, i));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

// ----------------------------------------------------------------------
teste('fixture real: o POST 2 sai do formulário do POST 1, só com as chaves que a linha tem', async () => {
  const t = await casoEduSemCadastro();
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  const p = t.post2Params();
  igual(Object.keys(p), ['bookingPaxes', 'comId', 'action', 'optionID', 'UID']);
  // POST 2 vai para a mesma URL do POST 1 (o site: urlChangeParams(location.href) na booking.aspx)
  assert.ok(t.post2()[0].url.endsWith(t.post1()[0].url), t.post2()[0].url);
  const bp = JSON.parse(p.bookingPaxes);
  assert.strictEqual(bp[0].numHab, 1);
  const chaves = ['paxType', 'paxAge', 'treatment', 'name', 'surname', 'birthday', 'resident', 'idTDC',
                  'documentNumber', 'fidelityProgram', 'baggage', 'tipoSocio', 'numeroSocio', 'comId',
                  'numberOfBags', 'baggageSelection'];
  bp[0].paxes.forEach((x) => igual(Object.keys(x).sort(), chaves.slice().sort(), JSON.stringify(x)));
  igual(bp[0].paxes.map((x) => x.paxType + '/' + x.paxAge), ['0/30', '0/30', '1/7', '1/4']);
  // padrões do formulário: tipo de documento CPF, programa "Tudo Azul" mesmo sem número
  igual(bp[0].paxes.map((x) => x.idTDC + '|' + x.tipoSocio), Array(4).fill('4|Tudo Azul'));
  igual(bp[0].paxes.map((x) => x.documentNumber),
        ['000.000.000-01', '000.000.000-02', '000.000.000-03', '000.000.000-09']);
  igual(bp[0].paxes.map((x) => x.name + ' ' + x.surname),
        ['TESTE ADULTO UM', 'TESTE ADULTO DOIS', 'TESTE CRIANCA SETE', 'TESTE CRIANCA MANUAL']);
  igual(bp[0].paxes.map((x) => x.comId), ['00000000001', '00000000002', '00000000003', '']);
  igual(bp[0].paxes.map((x) => x.treatment), ['MR', 'MR', 'MSTR', 'MSTR']);
});

teste('comId do topo no formato do site: todas as linhas, na ordem, vazio inclusive', async () => {
  const t = await casoEduSemCadastro();
  await t.api.reservar();
  assert.strictEqual(t.post2Params().comId, '00000000001,00000000002,00000000003,');
});

teste('equivalência: bookingPaxes e comId iguais, byte a byte, aos do serializer real do site', async () => {
  const t = await casoEduSemCadastro();
  await t.api.reservar();
  const site = carregarSite(t);
  if (!site) { console.log('   (sem o JS do site na workspace — pulei)'); return; }
  const p = t.post2Params();
  const $bd = bdDoPost1(t);
  assert.strictEqual(p.bookingPaxes, site.paxes($bd));
  igual({ comId: p.comId }, site.hidden($bd));
});

teste('hipotético: formulário pede "Sexo" (pax-gender) para criança → barra depois do POST 1, painel mostra o campo', async () => {
  const t = await casoEduSemCadastro({ post1Ajuste: GENERO });
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 1);
  assert.strictEqual(t.post2().length, 0, 'não podia ter mandado o POST 2');
  assert.ok(/Criança 1: o formulário do site pede "Sexo"/.test(t.log()), t.log());
  const sels = t.panel.querySelectorAll('select[data-f=x][data-n=pax-gender]');
  assert.strictEqual(sels.length, 2);
  igual(Array.prototype.map.call(sels[0].options, (o) => o.value), ['', 'M', 'F']);
  // a pessoa escolhe e manda de novo: novo POST 1, o que escolheu continua lá
  sels[0].value = 'M'; sels[0].dispatchEvent(new t.w.Event('change', { bubbles: true }));
  let s2 = t.panel.querySelectorAll('select[data-f=x][data-n=pax-gender]')[1];
  s2.value = 'F'; s2.dispatchEvent(new t.w.Event('change', { bubbles: true }));
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 2);
  assert.strictEqual(t.post2().length, 1, t.log());
  const bp = JSON.parse(t.post2Params().bookingPaxes)[0].paxes;
  igual(bp.map((x) => x.gender), [null, null, 'M', 'F']);   // null = chave ausente
  assert.ok(!('gender' in bp[0]), 'adulto sem o campo não manda gender');
});

teste('hipotético: expedição do documento escondida recebe o data-cpf-date (como o init do site com CPF)', async () => {
  const t = await casoEduSemCadastro({ post1Ajuste: EXPEDICAO });
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  const bp = JSON.parse(t.post2Params().bookingPaxes)[0].paxes;
  igual(bp.map((x) => x.documentExpedition), Array(4).fill('01/01/1900'));
  // campo obrigatório mas escondido pelo site: não vira pergunta no painel
  assert.strictEqual(t.panel.querySelectorAll('[data-f=x]').length, 0);
});

teste('hipotético: e-mail/nacionalidade vêm da consulta do CPF, como no "Validar CPF" do site', async () => {
  const t = await casoEduSemCadastro({ post1Ajuste: CONTATO });
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  const bp = JSON.parse(t.post2Params().bookingPaxes)[0].paxes;
  // adulto 1 tem e-mail/nacionalidade no cadastro (harness); adulto 2 não: o site põe "" e nenhuma nacionalidade
  assert.strictEqual(bp[0].mail, 'teste.um@example.invalid');
  assert.strictEqual(bp[0].nationality, 'BR');
  assert.strictEqual(bp[1].mail, '');
  // .val(undefined) no <select>: no navegador fica sem opção (null); o jsdom cai na 1ª opção ('')
  assert.ok(bp[1].nationality === null || bp[1].nationality === '', String(bp[1].nationality));
  assert.ok(!('mail' in bp[2]) && !('mail' in bp[3]), 'linha de criança sem o campo não manda mail');
});

teste('hipotético: linha de criança sem documento → painel não exige, POST 2 sem idTDC/documento/comId dela', async () => {
  const t = montar({ barras: [BARRA], post1Idades: [7, 4], post1Ajuste: CRIANCA_SEM_DOC });
  await espera(0);
  t.escolher();
  ['00000000001', '00000000002', '00000000003'].forEach((cpf, i) => t.digitar(i, 'doc', cpf));
  t.clicar('lookup-all');
  await espera(1500);
  t.digitar(3, 'name', 'Teste'); t.digitar(3, 'surname', 'Sem Doc'); t.digitar(3, 'birthday', '03/03/2022');
  await t.api.reservar();
  // 1ª tentativa: antes do POST 1 o painel ainda não sabe que a linha não tem documento
  assert.ok(/falta o documento/.test(t.log()), t.log());
  assert.strictEqual(t.post1().length, 0);
  t.digitar(3, 'doc', '00000000004');
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  const p = t.post2Params();
  const bp = JSON.parse(p.bookingPaxes)[0].paxes;
  assert.ok(!('idTDC' in bp[3]) && !('documentNumber' in bp[3]) && !('comId' in bp[3]), JSON.stringify(bp[3]));
  assert.strictEqual(p.comId, '00000000001,00000000002,00000000003');   // 3 linhas com comId
  // e depois do POST 1 o painel já não pede documento para ela
  t.digitar(3, 'doc', '');
  assert.ok(!t.api.problemas().some((x) => /Criança 2.*documento/.test(x)), t.api.problemas().join(' | '));
});

teste('equivalência no formulário hipotético (sexo + expedição + contato + criança sem documento)', async () => {
  const t = montar({ barras: [BARRA], post1Idades: [7, 4],
                     post1Ajuste: juntar(GENERO, EXPEDICAO, CONTATO, CRIANCA_SEM_DOC) });
  await espera(0);
  t.escolher();
  ['00000000001', '00000000002', '00000000003', '00000000004'].forEach((cpf, i) => t.digitar(i, 'doc', cpf));
  t.clicar('lookup-all');
  await espera(1500);
  await t.api.reservar();                                   // barra: falta o sexo
  // cada change re-renderiza o painel: pega o select de novo a cada vez
  const nSel = t.panel.querySelectorAll('select[data-f=x]').length;
  assert.strictEqual(nSel, 2);
  for (let i = 0; i < nSel; i++) {
    const s = t.panel.querySelectorAll('select[data-f=x]')[i];
    s.value = i ? 'F' : 'M'; s.dispatchEvent(new t.w.Event('change', { bubbles: true }));
  }
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  const site = carregarSite(t);
  if (!site) { console.log('   (sem o JS do site na workspace — pulei)'); return; }
  const p = t.post2Params();
  const $bd = bdDoPost1(t);
  assert.strictEqual(p.bookingPaxes, site.paxes($bd));
  igual({ comId: p.comId }, site.hidden($bd));
});

teste('tudoazul sem login: POST 1 devolve a caixa de login (HTML real) → não manda o POST 2', async () => {
  const t = montar({ barras: [BARRA], preset: PRESET, post1Login: true });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 1);
  assert.strictEqual(t.post2().length, 0);
  assert.ok(/pediu login na tela de reserva/.test(t.log()), t.log());
});

teste('POST 1 sem formulário ("pontos insuficientes"): builder próprio, comId com uma posição por pax', async () => {
  const t = montar({ barras: [BARRA], preset: PRESET, post1Idades: null });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  // padrão salvo: todos com comId (hydrate) → 4 posições cheias
  assert.strictEqual(t.post2Params().comId, '00000000001,00000000002,00000000003,00000000004');
  t.api.diagnostico();
  assert.ok(t.logs.join('\n').indexOf('POST 2 montado por: builder próprio (POST 1 sem formulário)') > -1);
});

teste('modo form (painel aberto na booking.aspx): serializa a página, comId do formulário sem sobrescrever', async () => {
  const t = montar({ paginaBooking: true, preset: [PRESET[0], PRESET[1], PRESET[2],
    { type: '1', doc: '00000000004', docKind: 'cpf', name: 'TESTE', surname: 'CRIANCA QUATRO', birthday: '03/03/2022', treatment: 'MSTR' }] });
  await espera(0);
  assert.strictEqual(t.api.state.mode, 'form');
  // a criança de 4 consultada sem cadastro
  t.api.state.paxes[3].status = 'manual'; t.api.state.paxes[3].comId = '';
  await t.api.reservar();
  assert.strictEqual(t.enviosForm.length, 1, t.log());
  const p = t.enviosForm[0].params;
  igual(Object.keys(p), ['bookingPaxes', 'comId', 'action', 'optionID', 'UID']);
  assert.strictEqual(p.comId, '00000000001,00000000002,00000000003,');
  const bp = JSON.parse(p.bookingPaxes)[0].paxes;
  igual(bp.map((x) => x.comId), ['00000000001', '00000000002', '00000000003', '']);
  // (aqui, na booking.aspx de verdade, quem serializa é o $jbe.bookingPaxes do próprio site)
});

teste('diagnóstico: formulário do POST 1 e forma do POST 2 — sem nome, CPF, nascimento ou e-mail', async () => {
  const t = await casoEduSemCadastro({ post1Ajuste: CONTATO });
  await t.api.reservar();
  t.api.diagnostico();
  const d = t.logs.join('\n');
  assert.ok(d.indexOf('formulário do POST 1: A30[comId,idTDC,document-number,tipo-socio,numero-socio,treatment,name,surname,birthday,mail,nationality · idTDC=4(2/3/4) tipo-socio=Tudo Azul nationality="" treatment=MR]') > -1, d);
  assert.ok(d.indexOf('hidden-fields: comId,comId,comId,comId') > -1, d);
  assert.ok(d.indexOf('POST 2 montado por: formulário do POST 1 · campos: bookingPaxes,comId,action,optionID,UID · comId 4 posição(ões), 3 preenchida(s)') > -1, d);
  assert.ok(/C4\{treatment,name,surname,birthday,idTDC=4,documentNumber,tipoSocio\}/.test(d), d);
  ['00000000001', '00000000009', 'ADULTO UM', 'MANUAL', '03/03/2022', 'example.invalid', '11900000001'].forEach((x) => {
    assert.ok(d.indexOf(x) < 0, 'dado pessoal no diagnóstico: ' + x);
  });
});

teste('build minificado (docs/bookmarklet.js): mesmo POST 2 que o fonte', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'bookmarklet.js'), 'utf8');
  const a = await casoEduSemCadastro({ post1Ajuste: juntar(EXPEDICAO, CONTATO) });
  await a.api.reservar();
  const b = await casoEduSemCadastro({ post1Ajuste: juntar(EXPEDICAO, CONTATO), src });
  assert.strictEqual(b.api.version, a.api.version);
  await b.api.reservar();
  assert.strictEqual(b.post2().length, 1, b.log());
  igual(b.post2Params(), JSON.parse(JSON.stringify(a.post2Params())));
});

(async () => {
  let falhas = 0;
  for (const t of testes) {
    try { await t.fn(); console.log('ok   ' + t.nome); }
    catch (e) { falhas++; console.log('FAIL ' + t.nome + '\n     ' + String(e.stack || e).split('\n').slice(0, 8).join('\n     ')); }
  }
  console.log(`\n${testes.length - falhas}/${testes.length} ok`);
  process.exit(falhas ? 1 : 0);
})();
