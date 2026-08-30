# CTP Platform — __TENANT__

Build `__SHA__`.

## What you need

Docker Desktop for Windows — https://www.docker.com/products/docker-desktop/
Nothing else. No Node.js, no Git, no build step.

## Install

From this folder:

    docker load -i ctp-platform.tar
    docker compose up -d

Then open:

    http://localhost:3000/?tenant=__TENANT__

Confirm it started — the status should read `healthy`:

    docker compose ps

## Everyday use

    docker compose ps        check it is running
    docker compose logs -f   watch the log
    docker compose down      stop it
    docker compose up -d     start it again

## Your data

Scheduling data for `__TENANT__` is in the `config` folder beside this file. It
lives on this machine, not inside the container image, so it survives restarts
and upgrades.

If you edit those files by hand, restart to pick up the change:

    docker compose restart

Do not make the `config` folder read-only — the scheduler writes each new
schedule back into it.

## Upgrading

Replace `ctp-platform.tar` with the new one, then:

    docker compose down
    docker load -i ctp-platform.tar
    docker compose up -d

Your data and logs are untouched by an upgrade.

## If something is wrong

| What you see | Cause |
|---|---|
| `image not found` on `up` | `docker load` was not run, or did not finish |
| `Tenant '__TENANT__' not found` | the `config` folder was not unzipped beside this file |
| Page will not load | check the port — CTP is on **3000** |
| Solve fails after a clean start | the `config` folder is read-only; it must be writable |

To report a problem, include the version:

    curl.exe -H "X-Tenant-Id: __TENANT__" http://localhost:3000/v1/health/version
