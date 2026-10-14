'use strict';
// A stand-in for Bolagsverket's API, answering in the shape the register describes: a token for the
// right client id and secret, and one known organisation. Started on a free port; the server under test
// is pointed at it through the same environment variables a real install sets.
const http = require('node:http');

async function startFakeBolagsverket() {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/oauth2/token') {
        const basic = Buffer.from('test-client:test-secret').toString('base64');
        if (req.headers.authorization !== `Basic ${basic}`) { res.writeHead(401); return res.end('{}'); }
        return res.end(JSON.stringify({ access_token: 'tok-e2e', expires_in: 3600 }));
      }
      if (req.url === '/vdm/v1/organisationer' && req.headers.authorization === 'Bearer tok-e2e') {
        const asked = JSON.parse(raw || '{}').identitetsbeteckning;
        if (asked !== '5560125790') return res.end('{"organisationer":[]}');
        return res.end(JSON.stringify({ organisationer: [{
          organisationsnamn: { organisationsnamnLista: [{ namn: 'Testa Stål Aktiebolag' }] },
          organisationsform: { kod: 'AB', klartext: 'Aktiebolag' },
          postadressOrganisation: { postadress: { utdelningsadress: 'Industrigatan 4', postnummer: '21120', postort: 'MALMÖ' } },
          verksamOrganisation: { kod: 'JA' }
        }] }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const at = `http://127.0.0.1:${server.address().port}`;
  const env = {
    BOLAGSVERKET_CLIENT_ID: 'test-client', BOLAGSVERKET_CLIENT_SECRET: 'test-secret',
    BOLAGSVERKET_TOKEN_URL: `${at}/oauth2/token`, BOLAGSVERKET_API_URL: `${at}/vdm/v1`
  };
  return { env, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { startFakeBolagsverket };
