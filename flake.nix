{
  description = "Projektor development and CI environment with Vite+ tooling";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";
    vite-plus-overlay = {
      url = "github:ryoppippi/nix-vite-plus";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    bun2nix.follows = "vite-plus-overlay/bun2nix";
  };

  outputs =
    {
      nixpkgs,
      vite-plus-overlay,
      bun2nix,
      ...
    }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ vite-plus-overlay.overlays.default ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.bun
              bun2nix.packages.${system}.default
              pkgs.vite-plus
              pkgs.nixfmt
            ];
          };
        }
      );
    };
}
