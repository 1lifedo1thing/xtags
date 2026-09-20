const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/service.js'), 'utf8'), context);
const service = context.XtagsService;

test('custom endpoints require HTTPS and exclude URL credentials, queries and fragments', () => {
  for (const value of ['', null, 'http://api.example.com/v1', 'ftp://example.com',
    'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret',
    'https://example.com/v1#fragment', 'https://*.example.com/v1', 'https://example.com/a b',
    'https://example.com\\evil', 'https://example.com/v1?', 'https://example.com/v1#']) {
    assert.throws(() => service.normalize(value), { code: 'errorInvalidEndpoint' });
  }
  assert.equal(service.normalize(' https://API.Example.com:443/v1/systemone '), 'https://api.example.com/v1/systemone');
  assert.equal(service.originPattern('https://api.example.com:8443/custom/path'), 'https://api.example.com/*');
});

test('legacy consent remains valid only for official service; custom consent is bound to complete URL', () => {
  assert.equal(service.endpoint({}), service.OFFICIAL_URL);
  assert.equal(service.hasConsent({ consentVersion: 1 }), true);
  const apiEndpoint = 'https://proxy.example/v1/systemone';
  assert.equal(service.hasConsent({ consentVersion: 1, apiEndpoint }), false);
  assert.equal(service.hasConsent({ consentVersion: 1, apiEndpoint, consentEndpoint: apiEndpoint }), true);
  assert.equal(service.hasConsent({ consentVersion: 1, apiEndpoint: apiEndpoint + '/other', consentEndpoint: apiEndpoint }), false);
  assert.equal(service.hasConsent({ consentVersion: 1, apiEndpoint, consentEndpoint: '' }), false);
});
