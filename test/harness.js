/* Página de resultados de mentira para rodar o painel offline.
 *
 * jsdom + jQuery 1.12.4 (a versão do site) + o script de verdade. Nenhuma
 * requisição sai daqui: `fetch` é trocado por um roteador local que responde
 * a consulta de CPF, o POST 1 (tela de reserva) e o POST 2 (action=book).
 *
 * Os dados de pessoa são sintéticos (nomes TESTE, CPF 0000000000n).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function req(nome) {
  const caminhos = [nome, path.join(process.env.AZULTEST || '/tmp/azultest', 'node_modules', nome)];
  for (const c of caminhos) {
    try { return require(c); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new Error(`falta o módulo ${nome}: rode "npm install" na raiz do repo`);
}

const { JSDOM, VirtualConsole } = req('jsdom');
const JQUERY = fs.readFileSync(require.resolve('jquery/dist/jquery.js', {
  paths: [process.cwd(), __dirname, path.join(process.env.AZULTEST || '/tmp/azultest')]
}), 'utf8');

const FIX = path.join(__dirname, 'fixtures');
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

const SRC_ATUAL = fs.readFileSync(path.join(__dirname, '..', 'src', 'azul_paxes_page2.js'), 'utf8');

// pessoas sintéticas — nascimento pensado para o check-in de 18/12/2026
const PESSOAS = {
  '00000000001': { Name: 'TESTE', LastName: 'ADULTO UM', BirthDate: '01/01/1980', identifierNoFFP: '',
                   Email: 'teste.um@example.invalid', Mobile: '11900000001', Nationality: 'BR' },
  '00000000002': { Name: 'TESTE', LastName: 'ADULTO DOIS', BirthDate: '02/02/1982', identifierNoFFP: '' },
  '00000000003': { Name: 'TESTE', LastName: 'CRIANCA SETE', BirthDate: '10/05/2019', identifierNoFFP: '' },   // 7 no check-in
  '00000000004': { Name: 'TESTE', LastName: 'CRIANCA QUATRO', BirthDate: '03/03/2022', identifierNoFFP: '' }, // 4 no check-in
  '00000000005': { Name: 'TESTE', LastName: 'CRIANCA CINCO', BirthDate: '01/06/2021', identifierNoFFP: '' }   // 5 no check-in
};

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// seletor de quartos no formato do site (results_www.html do spike)
function roomSelectorHtml(o) {
  const quartos = o.dados;                       // JSON do data-room-selector-data
  const vivos = o.vivos || null;                 // {adults, children, ages:[...]} dos <select>
  const prefixo = o.searcher || 'hotel-searcher';
  const minAge = prefixo === 'trip-searcher' ? 2 : 0;
  const op = (v, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${v}</option>`;
  const faixa = (de, ate, sel) => { let h = ''; for (let i = de; i <= ate; i++) h += op(i, String(i) === String(sel)); return h; };
  const v = vivos || { adults: 2, children: 0, ages: [] };
  let idades = '';
  for (let i = 0; i < 9; i++) {
    idades += `<select id="rs-children-age-1-${i + 1}" class="form-control age js-pax-option" data-validate="age" ` +
              `data-min-age="${minAge}" data-max-age="17" data-pax-type-label="children">` +
              faixa(minAge, 17, v.ages[i] != null ? v.ages[i] : 5) + '</select>';
  }
  return `<div class="room-selector js-auto-form-param"${quartos ? ` data-room-selector-data="${esc(JSON.stringify(quartos))}"` : ''}>
    <label class="form-label floating-mode-label" for="${prefixo}-x_ctlRoomSelector-room-selector-button">Apartamentos</label>
    <button id="${prefixo}-x_ctlRoomSelector-room-selector-button" type="button" class="room-selector-button">1 Apartamentos</button>
    <div class="room-selector-box-container hidden"><fieldset class="room-selector-box">
      <select class="form-control nrooms">${faixa(1, 4, 1)}</select>
      <ul class="rooms-container"><li class="room"><div class="room-fields">
        <div class="passengers">
          <select class="form-control adults js-adults-selector">${faixa(1, 9, v.adults)}</select>
          <select class="form-control children js-children-selector">${faixa(0, 9, v.children)}</select>
        </div>
        <div class="passenger-info"><div class="children-info">
          <div class="ages js-children-ages">${idades}</div>
        </div></div>
      </div></li></ul>
    </fieldset></div>
  </div>`;
}

// Tela de reserva (booking.aspx) que o POST 1 devolve. Base REAL: o bloco de
// passageiros da booking.aspx do www de 13/08/2026 (fixtures/booking_form_www_2a.html,
// 2 adultos). As linhas de criança são cópia da linha de adulto com tipo/idade/
// títulos de criança — 🔴 sintéticas: o formulário real com criança só aparece
// logado (no tudoazul o POST 1 sem login devolve a caixa de login).
// `ajuste(linha, {tipo, idade, doc})` mexe numa linha (cenários hipotéticos).
const FORM_REAL = fs.readFileSync(path.join(FIX, 'booking_form_www_2a.html'), 'utf8');
function bookingHtml(idades, tripDate, ajuste) {
  const doc = new JSDOM('<!doctype html><html><body>' + FORM_REAL + '</body></html>').window.document;
  const room = doc.querySelector('.booking-paxes__room');
  const modelo = room.querySelector('.js-booking-paxes-pax-row');
  room.querySelectorAll('.js-booking-paxes-pax-row').forEach((r) => r.remove());
  const paxes = [[0, 30, 'Adulto 1'], [0, 30, 'Adulto 2']]
    .concat(idades.map((a, i) => [1, a, 'Criança ' + (i + 1)]));
  paxes.forEach(([tipo, idade, rot], i) => {
    const r = modelo.cloneNode(true);
    r.setAttribute('data-pax-row', String(i + 1));
    r.setAttribute('data-pax-type', String(tipo));
    r.setAttribute('data-pax-age', String(idade));
    r.setAttribute('data-pax-tripdate', tripDate);
    r.querySelector('.booking-paxes__pax-type').textContent = rot;
    if (tipo !== 0) {
      r.querySelector('[name=pax-treatment]').innerHTML =
        '<option value="MSTR">Criança (M)</option><option value="MISS">Criança (F)</option>';
    }
    if (ajuste) ajuste(r, { tipo, idade, doc });
    room.appendChild(r);
  });
  return '<html><body>' + doc.querySelector('.booking-data').outerHTML + '</body></html>';
}
const LOGIN_HTML = fs.readFileSync(path.join(FIX, 'booking_login_tudoazul.html'), 'utf8');

const ERRO_HTML = '<html><body><h1>Desculpe-nos, houve um erro</h1></body></html>';

/* Monta a página e roda o script.
 *   o.barras        lista de {dados, vivos, searcher}
 *   o.semPlugin     (sempre: não há $.fn.roomSelector no jsdom, a não ser o.plugin)
 *   o.plugin        função val() falsa para $.fn.roomSelector
 *   o.preset        padrão salvo (localStorage)
 *   o.post1Idades   idades das crianças na tela de reserva (null = sem formulário)
 *   o.post1Ajuste   função(linha, info) que mexe nas linhas do formulário do POST 1
 *   o.post1Login    POST 1 devolve a caixa de login (tudoazul sem sessão)
 *   o.post2         'ok' | 'erro'
 *   o.lookup        { cpf: 'ok' | 'erro' | 'demora' }
 *   o.url           URL da página
 *   o.src           fonte do script (default: o atual)
 *   o.paginaBooking  a página aberta é a booking.aspx com o formulário (modo form);
 *                   window.sendPost é trocado por um gravador (t.enviosForm)
 */
function montar(o) {
  o = o || {};
  const fx = fixture('www_taua_cache_item.json');
  const opcoes = fx.item.availability.options.map((x) =>
    `<div class="result-option" data-option-id="${x.ID}"></div>`).join('');
  const corpo = o.paginaBooking
    ? bookingHtml(o.post1Idades || [7, 4], '18/12/2026', o.post1Ajuste).replace(/^<html><body>|<\/body><\/html>$/g, '')
    : `<div id="header">${(o.barras || []).map(roomSelectorHtml).join('\n')}</div>
    <div class="search-summary__paxes">1 Apartamentos 4 Hóspedes</div>
    <div class="results-list"><div class="result" data-uid="${fx.uid}">${opcoes}</div></div>`;
  const html = `<!doctype html><html><head></head><body>
    ${corpo}
  </body></html>`;

  const logs = [];
  const vc = new VirtualConsole();
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', () => {});
  vc.on('warn', () => {});
  vc.on('jsdomError', () => {});                 // navegação (location.href = …) não existe no jsdom

  const dom = new JSDOM(html, {
    url: o.url || (o.paginaBooking
      ? 'https://www.azulviagens.com.br/hotels/booking.aspx?searchSessionID=705907&hashParams=x'
      : 'https://www.azulviagens.com.br/hotels/results.aspx?searchSessionID=705907'),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  w.eval(JQUERY);
  // jsdom (nwsapi) não entende `[class*="cookie" i]`; o Chrome entende. Só aqui,
  // no teste: se o seletor com flag `i` quebrar, tenta sem o flag.
  const findOrig = w.jQuery.find;
  const findCalco = function (sel) {
    try { return findOrig.apply(this, arguments); }
    catch (e) {
      if (typeof sel !== 'string' || !/ i\]/.test(sel)) throw e;
      const args = Array.prototype.slice.call(arguments);
      args[0] = sel.replace(/ i\]/g, ']');
      return findOrig.apply(this, args);
    }
  };
  Object.keys(findOrig).forEach((k) => { findCalco[k] = findOrig[k]; });
  w.jQuery.find = findCalco;
  if (o.plugin) w.jQuery.fn.roomSelector = function (m) { return m === 'val' ? o.plugin.call(this) : undefined; };

  const dist = o.dist || fx.item.availability.distribution;
  const item = JSON.parse(JSON.stringify(fx.item));
  item.availability.distribution = dist;
  w.$jbe = {
    results: {
      options: { searchInfo: { searchSessionID: '705907' }, config: { hasAllOptions: false } },
      cache: { items: { [fx.uid]: item } },
      filters: {}
    }
  };
  if (o.paginaBooking) {
    const op = fx.item.availability.options[0];
    w.$jbe.booking1 = { options: { data: { UID: fx.uid, optionID: op.ID } } };
  }
  const enviosForm = [];
  if (o.paginaBooking) {
    w.sendPost = (url, params) => enviosForm.push({ url, params: JSON.parse(JSON.stringify(params)) });
  }
  if (o.preset) w.localStorage.setItem('azulPaxPreset.v1', JSON.stringify(o.preset));

  const chamadas = [];
  const alertas = [];
  w.alert = (m) => alertas.push(m);
  w.confirm = () => true;
  w.fetch = function (url, init) {
    init = init || {};
    const u = String(url);
    const body = String(init.body || '');
    chamadas.push({ url: u, method: init.method || 'GET', body });
    const resp = (status, texto, urlFinal) => Promise.resolve({
      ok: status >= 200 && status < 300, status, url: urlFinal || ('https://www.azulviagens.com.br' + u),
      text: () => Promise.resolve(texto)
    });
    if (u.indexOf('getHolderInfo.ashx') > -1) {
      const id = /[?&]id=(\d+)/.exec(u)[1];
      const modo = (o.lookup || {})[id] || 'ok';
      if (modo === 'erro') return resp(500, 'erro');
      if (modo === 'demora') {
        return new Promise((_, rej) => setTimeout(() => rej(new Error('rede caiu')), 900));
      }
      const p = PESSOAS[id];
      return resp(200, JSON.stringify(p || { ErrorData: 'x' }));
    }
    if (u.indexOf('/hotels/booking.aspx') > -1 && body.indexOf('action=book') < 0) {
      if (o.post1Login) return resp(200, LOGIN_HTML);
      if (o.post1Idades === null) return resp(200, '<html><body><div class="booking-warning__content">Pontos insuficientes</div></body></html>');
      return resp(200, bookingHtml(o.post1Idades || [7, 4], '18/12/2026', o.post1Ajuste));
    }
    if (u.indexOf('/hotels/booking.aspx') > -1) {
      if (o.post2 === 'erro') return resp(500, ERRO_HTML);
      return resp(200, '<html><body>confirmação</body></html>',
                  'https://www.azulviagens.com.br/hotels/confirmBooking.aspx?x=1');
    }
    return Promise.reject(new Error('requisição inesperada no teste: ' + u));
  };

  w.eval(o.src || SRC_ATUAL);
  const api = w.__azulPax;
  const panel = w.document.getElementById('azul-pax-panel');
  return {
    w, api, chamadas, alertas, logs, panel, enviosForm,
    log: () => (panel.querySelector('#azul-pax-log') || {}).textContent || '',
    post1: () => chamadas.filter((c) => c.url.indexOf('booking.aspx') > -1 && c.body.indexOf('action=book') < 0),
    post2: () => chamadas.filter((c) => c.url.indexOf('booking.aspx') > -1 && c.body.indexOf('action=book') > -1),
    bookingPaxes: function () {
      const p2 = this.post2()[0];
      if (!p2) return null;
      const m = /(?:^|&)bookingPaxes=([^&]*)/.exec(p2.body);
      return JSON.parse(decodeURIComponent(m[1]));
    },
    // corpo do POST 2 como objeto (chave → valor), na ordem em que foi
    post2Params: function () {
      const p2 = this.post2()[0];
      if (!p2) return null;
      const out = {};
      p2.body.split('&').forEach((kv) => {
        const i = kv.indexOf('=');
        out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
      return out;
    },
    // escolhe a tarifa pelo dropdown do painel, como a pessoa faz
    escolher: function (rotulo) {
      const sel = panel.querySelector('select[data-f=pick]');
      const opt = Array.prototype.find.call(sel.options, (x) => x.textContent.indexOf(rotulo || 'Superior · Full Board') === 0);
      sel.value = opt.value;
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    digitar: function (i, campo, valor) {
      const el = panel.querySelector(`[data-f=${campo}][data-i="${i}"]`);
      el.value = valor;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    clicar: function (act) {
      panel.querySelector(`[data-act=${act}]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    }
  };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { montar, fixture, espera, PESSOAS, roomSelectorHtml, bookingHtml, JSDOM, JQUERY };
