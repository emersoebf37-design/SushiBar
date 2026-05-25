// lib/delivery.js

export function calcularTaxa(distanciaKm, motoboy_on){

  const km = Math.ceil(distanciaKm);

  if(km > 8){
    return {
      taxa: 0,
      entrega: false,
      motivo: "Endereço fora do raio máximo."
    };
  }

  let taxa = 2;

  if(km > 1){
    taxa += 1;
  }

  if(km > 2){
    taxa += (km - 2) * 2;
  }

  if(km > 3 && !motoboy_on){
    return {
      taxa: 0,
      entrega: false,
      motivo: "Fora da área de entrega."
    };
  }

  return {
    taxa,
    entrega: true
  };
}