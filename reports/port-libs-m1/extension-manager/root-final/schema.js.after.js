import { normalizeModkitIdentifier, normalizeModkitSourceIdentifier } from '@modkit/sdk';
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const EXTENSION_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const REPOSITORY_JSON_PATH = /^(?:\.\/)?(?![A-Za-z]:)(?!\\)(?!.*\\)(?!.*\u0000)(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/]+(?:\/[^/]+)*\.json$/u;
export class ExtensionManagerError extends Error {
    constructor(code, message, context = {}, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'ExtensionManagerError';
        this.code = code;
        this.context = Object.freeze({ ...context });
    }
}
function fail(code, message, context) {
    throw new ExtensionManagerError(code, message, context);
}
function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('extension-manager/schema-invalid', `${label} must be an object`);
    }
    return value;
}
function text(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail('extension-manager/schema-invalid', `${label} must be a non-empty string`);
    }
    return value.trim();
}
function optionalText(value, label) {
    return value === undefined ? undefined : text(value, label);
}
function base64Text(value, label) {
    if (typeof value !== 'string') {
        fail('extension-manager/schema-invalid', `${label} must be a string`);
    }
    return value;
}
function stringList(value, label) {
    if (!Array.isArray(value))
        fail('extension-manager/schema-invalid', `${label} must be a list`);
    return Object.freeze(value.map((item, index) => text(item, `${label}[${index}]`)));
}
function repositorySubjectPaths(value, label) {
    if (value === undefined)
        return Object.freeze([]);
    const paths = stringList(value, label);
    if (paths.length > 64) {
        fail('extension-manager/schema-invalid', `${label} must not contain more than 64 paths`);
    }
    const seen = new Set();
    return Object.freeze(paths.map((path, index) => {
        if (path.length > 512 || !REPOSITORY_JSON_PATH.test(path)) {
            fail('extension-manager/schema-invalid', `${label}[${index}] must be a confined repository-relative JSON path`);
        }
        const normalized = path.startsWith('./') ? path.slice(2) : path;
        if (seen.has(normalized)) {
            fail('extension-manager/schema-invalid', `${label} contains duplicate «${normalized}»`);
        }
        seen.add(normalized);
        return normalized;
    }));
}
export function normalizeWorkspaceConfiguration(value) {
    const input = object(value, 'workspace configuration');
    if (input.schemaVersion !== 1) {
        fail('extension-manager/schema-version-unsupported', 'workspace schemaVersion must be 1');
    }
    if (!Array.isArray(input.sources)) {
        fail('extension-manager/schema-invalid', 'workspace sources must be a list');
    }
    const ids = new Set();
    const sources = input.sources.map((raw, index) => {
        const source = object(raw, `sources[${index}]`);
        const id = normalizeModkitSourceIdentifier(text(source.id, `sources[${index}].id`));
        if (!SOURCE_ID.test(id))
            fail('extension-manager/source-id-invalid', `invalid source id «${id}»`);
        if (ids.has(id))
            fail('extension-manager/source-duplicate', `source «${id}» is duplicated`);
        ids.add(id);
        return Object.freeze({
            id,
            uri: text(source.uri, `sources[${index}].uri`),
            ...(source.environment === undefined
                ? {}
                : {
                    environment: text(source.environment, `sources[${index}].environment`),
                }),
            ...(source.descriptor === undefined
                ? {}
                : {
                    descriptor: text(source.descriptor, `sources[${index}].descriptor`),
                }),
            ...(source.publisher === undefined
                ? {}
                : { publisher: text(source.publisher, `sources[${index}].publisher`) }),
            enabled: source.enabled !== false,
        });
    });
    const profiles = {};
    if (input.profiles !== undefined) {
        const rawProfiles = object(input.profiles, 'profiles');
        for (const [name, raw] of Object.entries(rawProfiles)) {
            const profile = object(raw, `profiles.${name}`);
            profiles[name] = Object.freeze({
                ...(profile.sources === undefined
                    ? {}
                    : {
                        sources: Object.freeze(stringList(profile.sources, `profiles.${name}.sources`).map(source => normalizeModkitSourceIdentifier(source))),
                    }),
                ...(profile.extensions === undefined
                    ? {}
                    : {
                        extensions: Object.freeze(stringList(profile.extensions, `profiles.${name}.extensions`).map(extension => extension === '*' ? extension : normalizeModkitIdentifier(extension))),
                    }),
                locked: profile.locked === true,
            });
        }
    }
    const activeProfile = optionalText(input.activeProfile, 'activeProfile');
    if (activeProfile !== undefined && profiles[activeProfile] === undefined) {
        fail('extension-manager/profile-missing', `active profile «${activeProfile}» is not declared`);
    }
    const legacyPaths = [];
    if (input.legacyPaths !== undefined) {
        if (!Array.isArray(input.legacyPaths)) {
            fail('extension-manager/schema-invalid', 'legacyPaths must be a list');
        }
        for (const [index, raw] of input.legacyPaths.entries()) {
            const entry = object(raw, `legacyPaths[${index}]`);
            legacyPaths.push(Object.freeze({
                prefix: stringList(entry.prefix, `legacyPaths[${index}].prefix`),
                source: normalizeModkitSourceIdentifier(text(entry.source, `legacyPaths[${index}].source`)),
                strip: Number.isInteger(entry.strip) && entry.strip >= 0
                    ? entry.strip
                    : undefined,
            }));
        }
    }
    return Object.freeze({
        schemaVersion: 1,
        sources: Object.freeze(sources),
        profiles: Object.freeze(profiles),
        ...(activeProfile === undefined ? {} : { activeProfile }),
        ...(input.lockFile === undefined ? {} : { lockFile: text(input.lockFile, 'lockFile') }),
        legacyPaths: Object.freeze(legacyPaths),
    });
}
export function normalizeRepositoryManifest(value) {
    const input = object(value, 'repository manifest');
    if (input.schemaVersion !== 1) {
        fail('extension-manager/schema-version-unsupported', 'repository schemaVersion must be 1');
    }
    if (!Array.isArray(input.extensions)) {
        fail('extension-manager/schema-invalid', 'repository extensions must be a list');
    }
    const ids = new Set();
    const extensions = input.extensions.map((raw, index) => {
        const entry = object(raw, `extensions[${index}]`);
        const rawId = optionalText(entry.id, `extensions[${index}].id`);
        const id = rawId === undefined ? undefined : normalizeModkitIdentifier(rawId);
        if (id !== undefined && !EXTENSION_ID.test(id)) {
            fail('extension-manager/extension-id-invalid', `invalid extension id «${id}»`);
        }
        if (id !== undefined && ids.has(id)) {
            fail('extension-manager/extension-duplicate', `extension «${id}» is duplicated`);
        }
        if (id !== undefined)
            ids.add(id);
        const path = optionalText(entry.path, `extensions[${index}].path`);
        let files;
        if (entry.files !== undefined) {
            const rawFiles = object(entry.files, `extensions[${index}].files`);
            files = Object.freeze(Object.fromEntries(Object.entries(rawFiles).map(([name, encoded]) => [
                text(name, `extensions[${index}].files key`),
                base64Text(encoded, `extensions[${index}].files.${name}`),
            ])));
        }
        if (path === undefined && files === undefined) {
            fail('extension-manager/schema-invalid', `extensions[${index}] must declare path or embedded files`);
        }
        return Object.freeze({
            ...(id === undefined ? {} : { id }),
            ...(path === undefined ? {} : { path }),
            ...(files === undefined ? {} : { files }),
            enabled: entry.enabled !== false,
        });
    });
    let subjects;
    if (input.subjects !== undefined) {
        const rawSubjects = object(input.subjects, 'repository subjects');
        const vendors = repositorySubjectPaths(rawSubjects['vendors'], 'subjects.vendors');
        const games = repositorySubjectPaths(rawSubjects['games'], 'subjects.games');
        subjects = Object.freeze({ vendors, games });
    }
    return Object.freeze({
        schemaVersion: 1,
        extensions: Object.freeze(extensions),
        ...(subjects === undefined ? {} : { subjects }),
    });
}
export function normalizeExtensionLock(value) {
    const input = object(value, 'extension lock');
    if (input.schemaVersion !== 1) {
        fail('extension-manager/schema-version-unsupported', 'lock schemaVersion must be 1');
    }
    if (!Array.isArray(input.extensions)) {
        fail('extension-manager/schema-invalid', 'lock extensions must be a list');
    }
    const ids = new Set();
    const extensions = input.extensions.map((raw, index) => {
        const entry = object(raw, `extensions[${index}]`);
        const id = normalizeModkitIdentifier(text(entry.id, `extensions[${index}].id`));
        if (!EXTENSION_ID.test(id))
            fail('extension-manager/extension-id-invalid', `invalid lock id «${id}»`);
        if (ids.has(id))
            fail('extension-manager/extension-duplicate', `extension «${id}» is duplicated`);
        ids.add(id);
        return Object.freeze({
            id,
            source: normalizeModkitSourceIdentifier(text(entry.source, `extensions[${index}].source`)),
            version: text(entry.version, `extensions[${index}].version`),
            digest: text(entry.digest, `extensions[${index}].digest`).toLowerCase(),
        });
    });
    return Object.freeze({
        schemaVersion: 1,
        extensions: Object.freeze(extensions),
    });
}
