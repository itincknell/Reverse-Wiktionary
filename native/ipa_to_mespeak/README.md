# ipa-to-mespeak native extension

This package provides the native IPA-to-meSpeak transducer used by the serving
application. The production web image builds it as a Linux Python extension in
the Docker builder stage and copies only the installed package into the runtime
stage.
