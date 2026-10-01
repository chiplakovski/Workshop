# The one command that runs this system. Read by Railway, Render, Heroku and anything else built on
# buildpacks, so none of them has to be told by hand.
#
# No HOST here on purpose. The server defaults to 0.0.0.0, which is what a platform router needs;
# deploy/varmak.env.example sets HOST=127.0.0.1 because Caddy is in front of it on a machine you own,
# and setting that on a platform makes the app unreachable with nothing in the log to say why.
web: node backend/server.js
