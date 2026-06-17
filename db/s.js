function transformInput(inputArray) {
    return inputArray.map(inputData => {
      const { key, name, route } = inputData;
      const keyValues = key.map(item => item.value);
      return { key: keyValues, name, route };
    });
  }
  
  // Example usage:
  const inputArray = [
    {
      key: [
        { label: "0.75 / CPI-60", value: "CPI-60" },
        { label: "1 / CPI-45", value: "CPI-45" },
        { label: "1.5 / CPI-17", value: "CPI-17" },
        { label: "1.5 / CPI-40", value: "CPI-40" },
        { label: "2.5 / CPI-18", value: "CPI-18" },
        { label: "2.5 / CPI-19", value: "CPI-19" },
        { label: "4 / CPI-20", value: "CPI-20" },
        { label: "4 / CPI-21", value: "CPI-21" },
        { label: "6 / CPI-22", value: "CPI-22" },
        { label: "6 / CPI-23", value: "CPI-23" },
        { label: "10 / CPI-24", value: "CPI-24" },
        { label: "16 / CPI-25", value: "CPI-25" }
      ],
      name: "Dowell's Lugs Copper Pin-Type Insulated",
      route: "/dowells/lugs/copper/pin-type/insulated"
    },
    {
      key: [
        { label: "0.75 / CPI-60", value: "CPI-60" },
        { label: "1 / CPI-45", value: "CPI-45" }
      ],
      name: "Dowell's Lugs Copper Fork-Type Insulated",
      route: "/dowells/lugs/copper/fork-type/insulated"
    }
  ];