#!/bin/sh
# Führt einen Befehl aus und vertraut dabei zusätzlich dem CA-Zertifikat aus dem
# Build-Secret "extra_ca", falls vorhanden. Ohne Secret: unveränderte Ausführung.
if [ -s /run/secrets/extra_ca ]; then
  export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca
fi
exec "$@"
