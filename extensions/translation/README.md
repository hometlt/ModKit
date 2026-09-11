# Modkit Translation

Machine translation as a service any format can resolve, rather than a feature inside one codec.

The six backends came from MK2's StarCraft II localization codec, which carried them alongside the
markup protection they served. Only the transports are vendor-neutral, so only they are here: a
caller masks whatever its format treats as markup, converts the masks to the `[[MK0]]` placeholder
form this contract agrees on, and checks the result when it comes back.

Credentials are supplied by the host when the provider is created, never in a request — an API key
in an operation input travels through the same JSON that is logged, cached and shown in receipts.
