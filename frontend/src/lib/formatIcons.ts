/** Map Cloudsmith package format → Devicon SVG URL (jsDelivr/raw GitHub CDN).
 *  Using .svg URLs so consumers (e.g. @sigma/node-image) get the dedicated
 *  SVG→bitmap loading path for best rendering quality. */
const DI = "https://raw.githubusercontent.com/devicons/devicon/v2.17.0/icons";

export const FORMAT_ICONS: Record<string, string> = {
  docker:    `${DI}/docker/docker-original.svg`,
  npm:       `${DI}/npm/npm-original-wordmark.svg`,
  python:    `${DI}/python/python-original.svg`,
  maven:     `${DI}/maven/maven-original.svg`,
  nuget:     `${DI}/nuget/nuget-original.svg`,
  ruby:      `${DI}/ruby/ruby-original.svg`,
  go:        `${DI}/go/go-original.svg`,
  cargo:     `${DI}/rust/rust-line.svg`,
  helm:      `${DI}/helm/helm-original.svg`,
  deb:       `${DI}/debian/debian-original.svg`,
  debian:    `${DI}/debian/debian-original.svg`,
  rpm:       `${DI}/redhat/redhat-original.svg`,
  composer:  `${DI}/composer/composer-line.svg`,
  swift:     `${DI}/swift/swift-original.svg`,
  dart:      `${DI}/dart/dart-original.svg`,
  terraform: `${DI}/terraform/terraform-original.svg`,
  cran:      `${DI}/r/r-original.svg`,
  conan:     `${DI}/cplusplus/cplusplus-original.svg`,
  hex:       `${DI}/elixir/elixir-original.svg`,
  luarocks:  `${DI}/lua/lua-original.svg`,
};

export function getFormatIcon(format: string): string | null {
  return FORMAT_ICONS[format.toLowerCase()] ?? null;
}
