import { ExtensionManagerError } from './schema.js';
const VENDOR_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const COORDINATE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const RESOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CAPABILITY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const RESOURCE_KINDS = new Set(['official', 'modding', 'documentation', 'community', 'source']);
const IMPORTANCE = new Set(['required', 'recommended']);
const PROFILE_KEYS = Object.freeze({
    vendor: new Set([
        '$schema',
        'schemaVersion',
        'kind',
        'id',
        'displayName',
        'description',
        'officialSite',
        'resources',
    ]),
    game: new Set([
        '$schema',
        'schemaVersion',
        'kind',
        'id',
        'vendorId',
        'displayName',
        'description',
        'officialSite',
        'resources',
        'extensionRequirements',
        'capabilityRequirements',
    ]),
});
function fail(message, context = {}) {
    throw new ExtensionManagerError('extension-manager/subject-profile-invalid', message, context);
}
function dataObject(value, label, allowedKeys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be an object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        fail(`${label} must be a plain JSON object`);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
        fail(`${label} must not contain symbol properties`);
    }
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable || !('value' in descriptor)) {
            fail(`${label}.${key} must be an enumerable data property`);
        }
        if (allowedKeys !== undefined && !allowedKeys.has(key)) {
            fail(`${label}.${key} is not allowed`);
        }
        result[key] = descriptor.value;
    }
    return result;
}
function text(value, label, maximum) {
    if (typeof value !== 'string')
        fail(`${label} must be a string`);
    const normalized = value.trim();
    if (normalized === '' || normalized.length > maximum) {
        fail(`${label} must contain 1 to ${maximum} characters`);
    }
    return normalized;
}
function optionalText(value, label, maximum) {
    return value === undefined ? undefined : text(value, label, maximum);
}
function identifier(value, label, pattern, maximum) {
    const normalized = text(value, label, maximum);
    if (!pattern.test(normalized))
        fail(`${label} has an invalid identifier`);
    return normalized;
}
function httpUrl(value, label) {
    const normalized = text(value, label, 2048);
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        fail(`${label} must be an absolute HTTP(S) URL`);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.hostname === '' ||
        parsed.username !== '' ||
        parsed.password !== '') {
        fail(`${label} must be an absolute HTTP(S) URL without credentials`);
    }
    return parsed.href;
}
function uniqueList(value, label, maximum, normalize, keyOf = item => item.id) {
    if (value === undefined)
        return Object.freeze([]);
    if (!Array.isArray(value))
        fail(`${label} must be a list`);
    if (value.length > maximum)
        fail(`${label} must not contain more than ${maximum} items`);
    const seen = new Set();
    return Object.freeze(value.map((item, index) => {
        const normalized = normalize(item, `${label}[${index}]`);
        const key = keyOf(normalized);
        if (seen.has(key))
            fail(`${label} contains duplicate «${key}»`, { duplicate: key });
        seen.add(key);
        return normalized;
    }));
}
function normalizeResource(value, label) {
    const input = dataObject(value, label, new Set(['id', 'label', 'url', 'kind']));
    const kind = optionalText(input.kind, `${label}.kind`, 32);
    if (kind !== undefined && !RESOURCE_KINDS.has(kind)) {
        fail(`${label}.kind is not supported`);
    }
    return Object.freeze({
        id: identifier(input.id, `${label}.id`, RESOURCE_ID, 96),
        label: text(input.label, `${label}.label`, 160),
        url: httpUrl(input.url, `${label}.url`),
        ...(kind === undefined ? {} : { kind }),
    });
}
function normalizeExtensionRequirement(value, label) {
    const input = dataObject(value, label, new Set(['id', 'importance']));
    const importance = text(input.importance, `${label}.importance`, 16);
    if (!IMPORTANCE.has(importance))
        fail(`${label}.importance is not supported`);
    return Object.freeze({
        id: identifier(input.id, `${label}.id`, COORDINATE, 257),
        importance,
    });
}
function normalizeCapabilityRequirement(value, label) {
    const input = dataObject(value, label, new Set(['id', 'displayName', 'importance', 'contributionIds']));
    const importance = text(input.importance, `${label}.importance`, 16);
    if (!IMPORTANCE.has(importance))
        fail(`${label}.importance is not supported`);
    return Object.freeze({
        id: identifier(input.id, `${label}.id`, CAPABILITY_ID, 128),
        displayName: text(input.displayName, `${label}.displayName`, 160),
        importance,
        contributionIds: uniqueList(input.contributionIds, `${label}.contributionIds`, 64, (item, itemLabel) => identifier(item, itemLabel, COORDINATE, 257), item => item),
    });
}
function commonProfile(value, expectedKind) {
    const label = `${expectedKind} subject profile`;
    const input = dataObject(value, label, PROFILE_KEYS[expectedKind]);
    if (input.schemaVersion !== 1)
        fail(`${label} schemaVersion must be 1`);
    if (input.kind !== expectedKind)
        fail(`${label} kind must be «${expectedKind}»`);
    const schema = optionalText(input.$schema, `${label}.$schema`, 2048);
    const officialSite = input.officialSite === undefined
        ? undefined
        : httpUrl(input.officialSite, `${label}.officialSite`);
    return {
        ...(schema === undefined ? {} : { $schema: schema }),
        schemaVersion: 1,
        kind: expectedKind,
        displayName: text(input.displayName, `${label}.displayName`, 160),
        description: text(input.description, `${label}.description`, 4000),
        ...(officialSite === undefined ? {} : { officialSite }),
        resources: uniqueList(input.resources, `${label}.resources`, 32, normalizeResource),
    };
}
export function normalizeVendorSubjectProfile(value) {
    const input = dataObject(value, 'vendor subject profile', PROFILE_KEYS.vendor);
    return Object.freeze({
        ...commonProfile(input, 'vendor'),
        id: identifier(input.id, 'vendor subject profile.id', VENDOR_ID, 128),
    });
}
export function normalizeGameSubjectProfile(value) {
    const input = dataObject(value, 'game subject profile', PROFILE_KEYS.game);
    const id = identifier(input.id, 'game subject profile.id', COORDINATE, 257);
    const vendorId = identifier(input.vendorId, 'game subject profile.vendorId', VENDOR_ID, 128);
    if (!id.startsWith(`${vendorId}/`)) {
        fail('game subject profile.id must belong to vendorId', { id, vendorId });
    }
    return Object.freeze({
        ...commonProfile(input, 'game'),
        id,
        vendorId,
        extensionRequirements: uniqueList(input.extensionRequirements, 'game subject profile.extensionRequirements', 64, normalizeExtensionRequirement),
        capabilityRequirements: uniqueList(input.capabilityRequirements, 'game subject profile.capabilityRequirements', 128, normalizeCapabilityRequirement),
    });
}
