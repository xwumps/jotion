#!/bin/sh
# Verschlüsselung der Sicherungen (Phase 12.1, ADR 130).
# Schlüssel werden aus dem Master Key abgeleitet (HMAC-SHA256 mit festem Zweck), nie der
# Master Key selbst: AES-256-CBC für den Inhalt, HMAC-SHA256 über IV und Chiffrat.

# hex_key <master-key-base64> <zweck> -> 64 Hex-Zeichen
hex_key() {
  mk="$(printf '%s' "$1" | base64 -d 2>/dev/null | od -An -v -tx1 | tr -d ' \n')"
  [ -n "$mk" ] || return 1
  printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:${mk}" -r | cut -d' ' -f1
}

# encrypt_payload <master-key> <eingabe> <ausgabe> -> gibt "iv mac" aus
encrypt_payload() {
  ek="$(hex_key "$1" jotion-backup-enc-v1)"
  ak="$(hex_key "$1" jotion-backup-mac-v1)"
  iv="$(openssl rand -hex 16)"
  openssl enc -aes-256-cbc -K "$ek" -iv "$iv" -in "$2" -out "$3"
  mac="$({ printf '%s' "$iv"; cat "$3"; } | openssl dgst -sha256 -mac HMAC -macopt "hexkey:${ak}" -r | cut -d' ' -f1)"
  echo "$iv $mac"
}

# mac_matches <master-key> <iv> <mac> <chiffrat> -> Exit 0, wenn der Schlüssel passt
mac_matches() {
  ak="$(hex_key "$1" jotion-backup-mac-v1)" || return 1
  got="$({ printf '%s' "$2"; cat "$4"; } | openssl dgst -sha256 -mac HMAC -macopt "hexkey:${ak}" -r | cut -d' ' -f1)"
  [ "$got" = "$3" ]
}

# decrypt_payload <master-key> <iv> <chiffrat> <ausgabe>
decrypt_payload() {
  ek="$(hex_key "$1" jotion-backup-enc-v1)"
  openssl enc -d -aes-256-cbc -K "$ek" -iv "$2" -in "$3" -out "$4"
}
