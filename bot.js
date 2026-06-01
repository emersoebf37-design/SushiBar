// ==========================================
        // ROTINA DE MÚLTIPLOS MOTOBOYS (ATUALIZADO!)
        // ==========================================
        let motoboyOn = false;
        let listaMotoboys = [];
        try {
          // Busca as configurações em tempo real do banco de dados
          const configSnap = await db.collection('config').doc('settings').get();
          if (configSnap.exists) {
            const configData = configSnap.data();
            motoboyOn = configData.motoboy_on === true || configData.motoboy_on === 'true';
            listaMotoboys = configData.motoboys || []; // Resgata o array de motoboys
          }
        } catch (configErr) {
          console.warn('⚠️ Erro ao ler config do motoboy no Firebase:', configErr.message);
        }

        const distanciaKm = Number(order.distanciaKm) || 0;

        // Validação: Sistema ativo E distância maior que 3km
        if (motoboyOn && distanciaKm > 3) {
          // Filtra dinamicamente apenas os motoboys que estão marcados como ATIVOS (true) no painel
          const motoboysAtivos = listaMotoboys.filter(m => m.active === true);
          
          if (motoboysAtivos.length > 0) {
            const textoMotoboy = mensagemMotoboy(order, senhaSorteada, googleMapsLink);
            
            // Loop assíncrono para enviar a mensagem para cada um dos entregadores online
            for (const motoboy of motoboysAtivos) {
              if (motoboy.phone) {
                await enviarMensagem(motoboy.phone, textoMotoboy);
                console.log(` 🛵 Notificação disparada para o Motoboy Ativo: ${motoboy.name} (${motoboy.phone})`);
              }
            }
            console.log(`✅ Sucesso: Alerta de pedido enviado para todos os (${motoboysAtivos.length}) motoboys ativos.`);
          } else {
            console.warn('⚠️ O sistema de motoboy está ligado, mas nenhum motoboy individual está ativado no painel.');
          }
        } else {
          console.log(`ℹ️ Motoboys não notificados | Painel Geral Ativo: ${motoboyOn} | Distância do pedido: ${distanciaKm.toFixed(1)} km`);
        }
        // ==========================================