import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('preview preserves full image and opens original', async () => {
  const code = await source('client/src/components/PostImage.jsx');
  assert.match(code, /object-contain/);
  assert.doesNotMatch(code, /object-cover/);
  assert.match(code, /setFullImageOpen\(true\)/);
  assert.match(code, /widthClass="max-w-6xl"/);
  assert.match(code, /target="_blank" rel="noopener noreferrer"/);
});

test('admin upload form uses the same uncropped preview and cleans up object URL', async () => {
  const code = await source('client/src/pages/admin/AdminContentPage.jsx');
  assert.match(code, /<PostImage src=\{form\.preview\}/);
  assert.match(code, /<PostImage src=\{item\.image_url\}/);
  assert.match(code, /URL\.createObjectURL\(file\)/);
  assert.match(code, /URL\.revokeObjectURL\(preview\)/);
  assert.match(code, /formData\.append\("image", form\.image\)/);
});

test('full news article and related cards use uncropped images', async () => {
  const code = await source('client/src/pages/client/NewsArticlePage.jsx');
  assert.match(code, /<PostImage src=\{article\.imageUrl\}/);
  assert.match(code, /<PostImage src=\{item\.imageUrl\}/);
  assert.match(code, /interactive=\{false\}/);
  assert.doesNotMatch(code, /object-cover/);
});

test('published news cards and announcement detail show full images', async () => {
  const code = await source('client/src/pages/client/PublicFeedPage.jsx');
  assert.match(code, /<PostImage src=\{item\.imageUrl\}/);
  assert.match(code, /<PostImage src=\{selected\.imageUrl\}/);
  assert.doesNotMatch(code, /object-cover/);
});

test('home details modal displays full news/announcement photo', async () => {
  const code = await source('client/src/pages/client/Home.jsx');
  assert.match(code, /<PostImage src=\{selectedItem\.imageUrl\}/);
});
