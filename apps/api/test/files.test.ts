import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

let app: NestFastifyApplication;
let owner: Client;
let ws: string;

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetState(app);
  ({ client: owner, workspaceId: ws } = await setupOwner(app));
});

function multipart(data: Buffer, filename: string, contentType: string) {
  const boundary = '----jotiontest';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(
  c: Client,
  workspaceId: string,
  data: Buffer,
  filename = 'bild.jpg',
  type = 'image/jpeg',
) {
  const { body, headers } = multipart(data, filename, type);
  const res = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/files`,
    payload: body,
    headers: { ...headers, cookie: c.cookie! },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe('Bild-Uploads', () => {
  it('entfernt EXIF-Metadaten und liefert die Datei nur an Mitglieder aus', async () => {
    const jpeg = await sharp({
      create: { width: 64, height: 32, channels: 3, background: '#3366cc' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'GEHEIM-GPS-DATEN', Artist: 'Kamera' } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const res = await upload(owner, ws, jpeg);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mime: 'image/jpeg', width: 64, height: 32 });

    const dl = await app.inject({
      method: 'GET',
      url: res.body.url,
      headers: { cookie: owner.cookie! },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/jpeg');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(dl.rawPayload).metadata()).exif).toBeUndefined();
    expect(dl.rawPayload.includes(Buffer.from('GEHEIM'))).toBe(false);

    const otherWs = await owner.post('/api/workspaces', { name: 'Anderer' });
    const { client: outsider } = await addMember(app, owner, otherWs.body.id, 'out@test.local');
    const denied = await app.inject({
      method: 'GET',
      url: res.body.url,
      headers: { cookie: outsider.cookie! },
    });
    expect(denied.statusCode).toBe(404);
  });

  it('erkennt das Format am Inhalt, nicht am Namen', async () => {
    const res = await upload(
      owner,
      ws,
      Buffer.from('<script>alert(1)</script>'),
      'harmlos.png',
      'image/png',
    );
    expect(res.status).toBe(415);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await upload(owner, ws, svg, 'x.svg', 'image/svg+xml')).status).toBe(415);
  });

  it('nutzt hochgeladene Bilder als Icon, aber nicht in fremden Workspaces', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff0000' } })
      .png()
      .toBuffer();
    const file = (await upload(owner, ws, png, 'icon.png', 'image/png')).body;
    const page = (
      await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Mit Icon', scope: 'TEAM' })
    ).body;
    expect(
      (await owner.patch(`/api/pages/${page.id}`, { icon: { type: 'file', fileId: file.id } }))
        .status,
    ).toBe(200);

    const otherWs = (await owner.post('/api/workspaces', { name: 'Anderer' })).body;
    const foreign = (
      await owner.post(`/api/workspaces/${otherWs.id}/pages`, { title: 'X', scope: 'TEAM' })
    ).body;
    expect(
      (await owner.patch(`/api/pages/${foreign.id}`, { cover: { type: 'file', fileId: file.id } }))
        .status,
    ).toBe(400);
  });

  it('verweigert Uploads in fremde Workspaces', async () => {
    const otherWs = (await owner.post('/api/workspaces', { name: 'Anderer' })).body;
    const { client: outsider } = await addMember(app, owner, otherWs.id, 'out@test.local');
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect((await upload(outsider, ws, png, 'x.png', 'image/png')).status).toBe(404);
  });
});
