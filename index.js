import fs from 'fs/promises';
import fsSync from 'fs';
import { join } from 'path'
import { load } from 'cheerio'
import { createHash } from 'crypto'
import axios from 'axios';
import PQueue from 'p-queue';
import clone from 'just-clone'

// const { data } = await axios.get("http://db.ncdd.gov.kh/gazetteer/view/index.castle")
// http://db.ncdd.gov.kh/gazetteer/view/district.castle ds
// http://db.ncdd.gov.kh/gazetteer/view/commune.castle cm

// const { data } = await client.post('http://db.ncdd.gov.kh/gazetteer/view/province.castle',  new URLSearchParams({
//   pv: "1"
// }));


await fs.mkdir(".cache", { recursive: true });

async function post(url, body) {
  const key = hash(url + JSON.stringify(body));
  const file = join('.cache', key);
  if (fsSync.existsSync(file)) {
    return fs.readFile(file, 'utf-8');
  }

  const { data } = await axios.post(url, new URLSearchParams(body));
  await fs.writeFile(file, data, 'utf-8');
  return data;
}

async function get(url) {
  const key = hash(url);
  const file = join('.cache', key)
  if (fsSync.existsSync(file)) {
    return fs.readFile(file, 'utf-8');
  }

  const { data } = await axios.get(url);
  await fs.writeFile(file, data, 'utf-8');
  return data;
}

function hash(v) {
  return createHash('sha1').update(v).digest('hex');
}

async function provinces() {

  const html = await get("http://db.ncdd.gov.kh/gazetteer/view/index.castle");
  const $ = load(html);
  const values = $("tr[id]").map((i, row) => {
    const [
      code,
      name_km,
      name_en,
      krongCount,
      srokCount,
      khanCount,
      communeCount,
      sangkatCount,
      villagesCount,
      reference
    ] = $(row).children().map((i, el) => $(el).text()).get().slice(1);

    return {
      code,
      name: { km: name_km, en: name_en },
      numberOfDistict: {
        krong: +krongCount,
        srok: +srokCount,
        khan: +khanCount,
      },
      numberOfCommune: {
        commune: +communeCount,
        sangkat: +sangkatCount,
      },
      numberOfVillage: +villagesCount,
      reference
    }
  }).get()

  return { values }
}

async function districts(pv) {
  const html = await post("http://db.ncdd.gov.kh/gazetteer/view/province.castle", { pv });
  const $ = load(html);

  const boundary = $('#boundary tr').slice(1).map((_, row) => {
    let [direction, value] = $(row)
      .children()
      .map((i, el) => $(el)
        .text()
        .trim()
        .toLocaleLowerCase()
      ).get()
    if (!value) {
      value = null
    }
    return [[direction, value]]
  }).get()


  const values = $('tr[id]').map((_, row) => {
    const [
      code, name_km, name_en,
      communeCount,
      sangkatCount,
      villagesCount,
      reference
    ] = $(row).children().map((i, el) => $(el).text()).get().slice(1);
    return {
      code,
      name: { km: name_km, en: name_en },
      numberOfCommune: {
        commune: +communeCount,
        sangkat: +sangkatCount,
      },
      numberOfVillage: +villagesCount,
      reference
    }
  }).get()

  return {
    values,
    boundary: Object.fromEntries(boundary),
  }
}


async function communes(ds) {
  const html = await post("http://db.ncdd.gov.kh/gazetteer/view/district.castle", { ds });
  const $ = load(html);
  const boundary = $('#boundary tr').slice(1).map((_, row) => {
    let [direction, value] = $(row)
      .children()
      .map((i, el) => $(el)
        .text()
        .trim()
        .toLocaleLowerCase()
      ).get()

    if (!value) {
      value = null
    }

    return [[direction, value]]
  }).get()


  const values = $('tr[id]').map((_, row) => {
    const [
      code, name_km, name_en,
      villagesCount,
      reference
    ] = $(row).children().map((i, el) => $(el).text()).get().slice(1);

    return {
      code,
      name: { km: name_km, en: name_en },
      numberOfVillage: +villagesCount,
      reference
    }
  }).get()

  return {
    values,
    boundary: Object.fromEntries(boundary),
  }
}


async function villages(cm) {
  const html = await post("http://db.ncdd.gov.kh/gazetteer/view/commune.castle", { cm });
  const $ = load(html);
  const boundary = $('#boundary tr').slice(1).map((_, row) => {
    let [direction, value] = $(row)
      .children()
      .map((i, el) => $(el)
        .text()
        .trim()
        .toLocaleLowerCase()
      ).get()

    if (!value) {
      value = null
    }

    return [[direction, value]]
  }).get()


  const values = $('tr[id]').map((_, row) => {
    const [
      code, name_km, name_en,
      reference
    ] = $(row).children().map((i, el) => $(el).text()).get().slice(1);

    return {
      code,
      name: { km: name_km, en: name_en },
      reference
    }
  }).get()

  return {
    values,
    boundary: Object.fromEntries(boundary),
  }
}

const { values } = await provinces()

const data = [];
const flatten = [];

for (const province of values) {
  flatten.push(clone(province));

  const _districts = await districts(province.code);
  flatten.push(...clone(_districts.values));

  province.districts = _districts;
  for (const district of _districts.values) {

    const _communes = await communes(district.code);
    flatten.push(...clone(_communes.values));
    district.communes = _communes;

    for (const commune of _communes.values) {
      const _villages = await villages(commune.code);
      flatten.push(..._villages.values);
      commune.villages = _villages;
    }
  }

  data.push(province);
}

const flattenMap = Object.fromEntries(flatten.map(it => {
  const cloned = clone(it);
  const code = cloned.code;
  delete cloned.code; 
  return [code, cloned];
}));

await fs.mkdir("./dist", { recursive: true })

await fs.writeFile('./dist/tree.json', JSON.stringify(data, null, 2), 'utf-8');
await fs.writeFile('./dist/tree.min.json', JSON.stringify(data), 'utf-8');

await fs.writeFile('./dist/flatten.json', JSON.stringify(flatten, null, 2), 'utf-8');
await fs.writeFile('./dist/flatten.min.json', JSON.stringify(flatten), 'utf-8');

await fs.writeFile('./dist/dictionary.json', JSON.stringify(flattenMap, null, 2), 'utf-8');
await fs.writeFile('./dist/dictionary.min.json', JSON.stringify(flattenMap), 'utf-8');
