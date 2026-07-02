package aeonvamm

const (
	DexTypeAeonVAMM = "aeon-vamm"
	defaultChainID  = 4663 // Robinhood Chain
)

type Config struct {
	DexID          string `json:"dexId"`
	FactoryAddress string `json:"factoryAddress"`
	ChainID        int    `json:"chainId"`
}

var defaultConfig = &Config{
	DexID:          DexTypeAeonVAMM,
	FactoryAddress: "0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6",
	ChainID:        defaultChainID,
}
